import { createHash } from "node:crypto";

import { AgentRunState, AgentRunTerminalReason, Prisma, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type AgentRun, type OutboxEvent, type PrismaClient, type WorkloadAssignment } from "@prisma/client";

import { __CancelPendingRunApprovalAuthority } from "@opencrane/backend/server/iam/authorization";

import type { ClaimNextRunWorkloadCleanupResult, ConfirmRunWorkloadCleanupCommand, ConfirmRunWorkloadCleanupResult, RequestRunCancellationCommand, RequestRunCancellationResult, RunCancellationRepository, RunCancellationRepositoryConfig, RunWorkloadCleanupProjection } from "./run-cancellation.types.js";

/** Non-locking cleanup coordinates used only to establish canonical lock order. */
interface CleanupCandidateRow
{
	/** Cleanup event identifier. */
	readonly eventId: string;
	/** Logical run identifier. */
	readonly runId: string;
	/** Parent service locked before the run. */
	readonly agentServiceId: string;
}

/** Prisma-backed authority for fencing a run before its physical Job is removed. */
export class PrismaRunCancellationRepository implements RunCancellationRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Fixed claim and orphan-observation policy. */
	private readonly config: RunCancellationRepositoryConfig;

	/** Creates cancellation authority over canonical Postgres. */
	constructor(prisma: PrismaClient, config: RunCancellationRepositoryConfig)
	{
		if (!_ConfigIsValid(config)) throw new Error("run cancellation repository requires bounded namespace and lease policy");
		this.prisma = prisma;
		this.config = config;
	}

	/** Fences one exact current attempt and records any physical cleanup still required. */
	async requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>
	{
		if (!_CancellationCommandIsValid(command)) return { status: "conflict", reason: "invalid_request" };
		const config = this.config;
		return this.prisma.$transaction(async function _cancel(transaction: Prisma.TransactionClient): Promise<RequestRunCancellationResult>
		{
			// 1. Discover only the service lock key, then lock service -> run -> assignment -> authority -> outbox.
			const discovered = await transaction.agentRun.findUnique({ where: { id: command.runId } });
			if (discovered === null) return { status: "not_found" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${discovered.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${discovered.id}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discovered.id} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${discovered.id} AND "attempt" = ${command.expectedAttempt} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "workload_bootstraps" WHERE "run_id" = ${discovered.id} AND "attempt" = ${command.expectedAttempt} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_proof_keys" WHERE "run_id" = ${discovered.id} AND "attempt" = ${command.expectedAttempt} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "run_id" = ${discovered.id} AND "attempt" = ${command.expectedAttempt} ORDER BY "sequence" FOR UPDATE`);

			// 2. Reload every authority fact and classify replay before performing writes.
			const run = await transaction.agentRun.findUnique({ where: { id: discovered.id } });
			if (run === null) return { status: "not_found" };
			if (run.attempt !== command.expectedAttempt) return { status: "conflict", reason: "attempt_conflict" };
			if (run.state === AgentRunState.Cancelling || run.state === AgentRunState.Cancelled)
			{
				return { status: "idempotent", runId: run.id, attempt: run.attempt, state: run.state === AgentRunState.Cancelling ? "cancelling" : "cancelled" };
			}
			if (run.state === AgentRunState.Completed || run.state === AgentRunState.Failed) return { status: "conflict", reason: "terminal_run" };
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			if (!now) return { status: "conflict", reason: "authority_conflict" };
			const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			const attemptEvent = await transaction.outboxEvent.findUnique({ where: { idempotencyKey: `${run.id}:attempt:${run.attempt}` } });
			const service = await transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
			if (service === null || attemptEvent === null || attemptEvent.runId !== run.id || attemptEvent.attempt !== run.attempt) return { status: "conflict", reason: "authority_conflict" };

			// 3. Cancelling is the immediate product-authority fence; physical cleanup may follow later.
			const entered = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: run.state }, data: { state: AgentRunState.Cancelling } });
			if (entered.count !== 1) throw new Error("run cancellation lost its lifecycle fence");
			await transaction.workloadAssignment.updateMany({ where: { runId: run.id, attempt: run.attempt, state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
			await transaction.runProofKey.updateMany({ where: { runId: run.id, attempt: run.attempt, revokedAt: null }, data: { revokedAt: now } });
			await __CancelPendingRunApprovalAuthority(transaction, { runId: run.id, attempt: run.attempt, now });
			await transaction.outboxEvent.updateMany({ where: { runId: run.id, attempt: run.attempt, kind: { in: [RunOutboxEventKind.RunAttemptRequested, RunOutboxEventKind.RunWorkloadReleaseRequested] }, publishedAt: null, failedAt: null }, data: { failedAt: now, failureCode: "RUN_CANCELLED" } });

			// 4. Record the cancellation request and either prove no Job can exist or schedule cleanup.
			const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			let sequence = (maximum._max.sequence ?? 0) + 1;
			await transaction.outboxEvent.create({ data: { runId: run.id, attempt: run.attempt, sequence, kind: RunOutboxEventKind.RunCancellationRequested, idempotencyKey: `${run.id}:cancellation:${run.attempt}`, payload: { runId: run.id, attempt: run.attempt, requestedBy: command.requestedBy }, availableAt: now } });
			const cleanup = _CleanupProjection(run, assignment, bootstrap?.id ?? _BootstrapReference(attemptEvent.id, run, config.namespace), service.workloadProfile, config.namespace, "cancellation");
			const inFlightCreateMayExist = assignment !== null || attemptEvent.claimedAt !== null;
			if (inFlightCreateMayExist)
			{
				sequence += 1;
				const availableAt = assignment !== null ? now : new Date(Math.max(now.getTime(), attemptEvent.claimedAt!.getTime() + config.claimLeaseMilliseconds + config.orphanObservationMarginMilliseconds));
				await transaction.outboxEvent.create({ data: { runId: run.id, attempt: run.attempt, sequence, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, idempotencyKey: `${run.id}:cleanup:${run.attempt}`, payload: cleanup as unknown as Prisma.InputJsonObject, availableAt } });
				return { status: "cancelling", runId: run.id, attempt: run.attempt, cleanupRequired: true };
			}

			// No claim ever left Postgres and the attempt event is now failed under lock: absence is authoritative.
			await _FinalizeCancelledRun(transaction, run, now);
			return { status: "cancelled", runId: run.id, attempt: run.attempt, cleanupRequired: false };
		});
	}

	/** Claims one cleanup event after its safety horizon and revalidates its run authority. */
	async claimNextWorkloadCleanupAtomically(): Promise<ClaimNextRunWorkloadCleanupResult>
	{
		const config = this.config;
		return this.prisma.$transaction(async function _claim(transaction: Prisma.TransactionClient): Promise<ClaimNextRunWorkloadCleanupResult>
		{
			const candidates = await transaction.$queryRaw<CleanupCandidateRow[]>(Prisma.sql`
				SELECT event."id" AS "eventId", event."run_id" AS "runId", run."agent_service_id" AS "agentServiceId"
				FROM "run_outbox_events" event JOIN "agent_runs" run ON run."id" = event."run_id" AND run."attempt" = event."attempt"
				WHERE event."kind" = 'run.workload_cleanup_requested'::"RunOutboxEventKind"
				  AND event."published_at" IS NULL AND event."failed_at" IS NULL AND event."available_at" <= clock_timestamp()
				  AND (event."claimed_at" IS NULL OR event."claimed_at" <= clock_timestamp() - (${config.claimLeaseMilliseconds} * interval '1 millisecond'))
				ORDER BY event."available_at", event."created_at", event."id" LIMIT 1
			`);
			const candidate = candidates[0];
			if (!candidate) return { status: "none" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${candidate.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.runId}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${candidate.runId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${candidate.eventId} FOR UPDATE`);
			const event = await transaction.outboxEvent.findUnique({ where: { id: candidate.eventId } });
			const run = await transaction.agentRun.findUnique({ where: { id: candidate.runId } });
			const now = (await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`))[0]?.now;
			const workload = _ParseCleanupProjection(event?.payload);
			if (!now || !event || !run || !workload || !_CleanupClaimIsCurrent(event, run, workload, now, config.claimLeaseMilliseconds)) return { status: "none" };
			const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
			const deliveryCount = event.deliveryCount + 1;
			const claimed = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount } });
			if (claimed.count !== 1) throw new Error("run workload cleanup lost its event fence");
			return { status: "claimed", claim: { lease: { eventId: event.id, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + config.claimLeaseMilliseconds).toISOString() }, workload } };
		});
	}

	/** Confirms exact physical cleanup and finalises a cancelling run only after that evidence commits. */
	async confirmWorkloadCleanupAtomically(eventId: string, command: ConfirmRunWorkloadCleanupCommand): Promise<ConfirmRunWorkloadCleanupResult>
	{
		if (!_ConfirmationIsValid(eventId, command)) return { status: "conflict", reason: "invalid_confirmation" };
		return this.prisma.$transaction(async function _confirm(transaction: Prisma.TransactionClient): Promise<ConfirmRunWorkloadCleanupResult>
		{
			const discoveredEvent = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			if (!discoveredEvent) return { status: "conflict", reason: "claim_not_found" };
			const discoveredRun = await transaction.agentRun.findUnique({ where: { id: discoveredEvent.runId } });
			if (!discoveredRun) return { status: "conflict", reason: "authority_conflict" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${discoveredRun.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${discoveredRun.id}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discoveredRun.id} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${eventId} FOR UPDATE`);
			const event = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			const run = await transaction.agentRun.findUnique({ where: { id: discoveredRun.id } });
			const now = (await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`))[0]?.now;
			const workload = _ParseCleanupProjection(event?.payload);
			if (!event || !run || !now || !workload || !_ConfirmationMatches(event, workload, command)) return { status: "conflict", reason: "authority_conflict" };
			const runFinalized = workload.reason === "cancellation";
			if (event.publishedAt !== null) return { status: "idempotent", runId: run.id, attempt: event.attempt, runFinalized: run.state === AgentRunState.Cancelled };
			if (event.failedAt !== null) return { status: "conflict", reason: "claim_terminal" };
			if (event.claimedAt?.getTime() !== Date.parse(command.claimedAt) || event.deliveryCount !== command.deliveryCount) return { status: "conflict", reason: "stale_claim" };
			if (runFinalized && run.state !== AgentRunState.Cancelling) return { status: "conflict", reason: "authority_conflict" };
			const published = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { publishedAt: now } });
			if (published.count !== 1) throw new Error("run workload cleanup lost its confirmation fence");
			if (runFinalized) await _FinalizeCancelledRun(transaction, run, now);
			return { status: "confirmed", runId: run.id, attempt: event.attempt, runFinalized };
		});
	}
}

/** Validate repository configuration before it reaches SQL or Kubernetes coordinates. */
function _ConfigIsValid(config: RunCancellationRepositoryConfig): boolean
{
	return config.namespace.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(config.namespace)
		&& Number.isSafeInteger(config.claimLeaseMilliseconds) && config.claimLeaseMilliseconds >= 1_000 && config.claimLeaseMilliseconds <= 300_000
		&& Number.isSafeInteger(config.orphanObservationMarginMilliseconds) && config.orphanObservationMarginMilliseconds >= 1_000 && config.orphanObservationMarginMilliseconds <= 60_000;
}

/** Reject malformed cancellation coordinates before opening a transaction. */
function _CancellationCommandIsValid(command: RequestRunCancellationCommand): boolean
{
	return command.runId.length > 0 && command.runId.length <= 256 && Number.isSafeInteger(command.expectedAttempt) && command.expectedAttempt > 0 && command.requestedBy.length > 0 && command.requestedBy.length <= 512;
}

/** Derive the same non-secret bootstrap reference used by dispatch for an unassigned attempt. */
function _BootstrapReference(eventId: string, run: Pick<AgentRun, "id" | "attempt" | "siloId" | "agentServiceId" | "agentRevisionId" | "inputSnapshotDigest">, namespace: string): string
{
	const canonical = JSON.stringify(["opencrane-workload-bootstrap-reference-v1", eventId, run.id, run.attempt, run.siloId, run.agentServiceId, run.agentRevisionId, run.inputSnapshotDigest, namespace]);
	return `bootstrap-v1_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Build the durable cleanup payload from run authority rather than caller input. */
function _CleanupProjection(run: AgentRun, assignment: WorkloadAssignment | null, bootstrapReference: string, workloadProfile: string, namespace: string, reason: RunWorkloadCleanupProjection["reason"]): RunWorkloadCleanupProjection
{
	return { runId: run.id, attempt: run.attempt, siloId: run.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, namespace: assignment?.namespace ?? namespace, workloadProfile: assignment?.workloadProfile ?? workloadProfile, bootstrapReference, workloadUid: assignment?.workloadUid ?? null, mode: assignment === null ? "unassigned_orphan" : "assigned", reason };
}

/** Parse one internally persisted cleanup payload without trusting arbitrary JSON. */
function _ParseCleanupProjection(value: Prisma.JsonValue | undefined): RunWorkloadCleanupProjection | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, Prisma.JsonValue>;
	if (typeof item["runId"] !== "string" || typeof item["attempt"] !== "number" || typeof item["siloId"] !== "string" || typeof item["agentServiceId"] !== "string" || typeof item["agentRevisionId"] !== "string" || typeof item["namespace"] !== "string" || typeof item["workloadProfile"] !== "string" || typeof item["bootstrapReference"] !== "string") return null;
	if (item["workloadUid"] !== null && typeof item["workloadUid"] !== "string") return null;
	if (item["mode"] !== "assigned" && item["mode"] !== "unassigned_orphan") return null;
	if (item["reason"] !== "cancellation" && item["reason"] !== "dispatch_failure") return null;
	return { runId: item["runId"], attempt: item["attempt"], siloId: item["siloId"], agentServiceId: item["agentServiceId"], agentRevisionId: item["agentRevisionId"], namespace: item["namespace"], workloadProfile: item["workloadProfile"], bootstrapReference: item["bootstrapReference"], workloadUid: item["workloadUid"], mode: item["mode"], reason: item["reason"] };
}

/** Revalidate a cleanup event after canonical locks are held. */
function _CleanupClaimIsCurrent(event: OutboxEvent, run: AgentRun, workload: RunWorkloadCleanupProjection, now: Date, claimLeaseMilliseconds: number): boolean
{
	return event.kind === RunOutboxEventKind.RunWorkloadCleanupRequested && event.runId === run.id && event.attempt === run.attempt && workload.runId === run.id && workload.attempt === run.attempt
		&& event.publishedAt === null && event.failedAt === null && event.availableAt.getTime() <= now.getTime() && (event.claimedAt === null || event.claimedAt.getTime() <= now.getTime() - claimLeaseMilliseconds)
		&& (workload.reason === "dispatch_failure" || run.state === AgentRunState.Cancelling);
}

/** Validate confirmation syntax before loading durable authority. */
function _ConfirmationIsValid(eventId: string, command: ConfirmRunWorkloadCleanupCommand): boolean
{
	return eventId.length > 0 && eventId.length <= 256 && command.runId.length > 0 && command.runId.length <= 256 && Number.isSafeInteger(command.attempt) && command.attempt > 0 && Number.isSafeInteger(command.deliveryCount) && command.deliveryCount > 0 && Number.isFinite(Date.parse(command.claimedAt)) && (command.workloadUid === null || command.workloadUid.length > 0);
}

/** Bind cleaner confirmation back to the exact database-issued cleanup projection. */
function _ConfirmationMatches(event: OutboxEvent, workload: RunWorkloadCleanupProjection, command: ConfirmRunWorkloadCleanupCommand): boolean
{
	return event.kind === RunOutboxEventKind.RunWorkloadCleanupRequested && event.runId === command.runId && event.attempt === command.attempt && workload.runId === command.runId && workload.attempt === command.attempt && workload.workloadUid === command.workloadUid;
}

/** Enter the sole Cancelled terminal state and append its canonical conversation event. */
async function _FinalizeCancelledRun(transaction: Prisma.TransactionClient, run: Pick<AgentRun, "id" | "attempt" | "threadId">, now: Date): Promise<void>
{
	const finalized = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Cancelling }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: now } });
	if (finalized.count !== 1) throw new Error("run cancellation lost its cleanup confirmation fence");
	if (run.threadId !== null)
	{
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.conversationRunEvent.create({ data: { runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: "run.cancelled", payload: { terminalReason: "user_cancelled" }, occurredAt: now } });
	}
}
