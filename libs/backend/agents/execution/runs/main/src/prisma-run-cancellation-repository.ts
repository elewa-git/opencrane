import { AgentRunState, AgentRunTerminalReason, AgentServiceKind, Prisma, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type AgentRun, type OutboxEvent, type PrismaClient, type WorkloadAssignment } from "@prisma/client";

import { __CancelPendingRunApprovalAuthority } from "@opencrane/backend/server/iam/authorization";

import { __DeliverChildRunCompletionInTransaction } from "./prisma-child-run-completion-repository";
import { __AgentRunWorkflowBootstrapReference } from "./agent-run-workflow-bootstrap-reference";
import { PrismaAgentRunWorkflowTaskRepository } from "./prisma-agent-run-workflow-task-repository";
import { PrismaRunCancellationEventDeferralUnitOfWork } from "./prisma-run-cancellation-event-deferral-repository";
import type { ClaimNextRunWorkloadCleanupResult, ConfirmRunWorkloadCleanupCommand, ConfirmRunWorkloadCleanupResult, RequestRunCancellationCommand, RequestRunCancellationResult, RunCancellationRepository, RunCancellationRepositoryConfig, RunWorkloadCleanupClaim, RunWorkloadCleanupProjection } from "./run-cancellation.types";

/**
 * Fences a run in Postgres before its physical workload is removed.
 */
export class PrismaRunCancellationRepository implements RunCancellationRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Fixed claim and orphan-observation policy. */
	private readonly config: RunCancellationRepositoryConfig;
	/** Provides one application timestamp for each serializable operation. */
	private readonly now: () => Date;

	/** Creates cancellation authority over canonical Postgres. */
	constructor(prisma: PrismaClient, config: RunCancellationRepositoryConfig, now: () => Date = function _Now() { return new Date(); })
	{
		if (!_ConfigIsValid(config)) throw new Error("run cancellation repository requires distinct bounded runtime namespaces and lease policy");
		this.prisma = prisma;
		this.config = config;
		this.now = now;
	}

	/** Fences one exact current attempt and records any physical cleanup still required. */
	async requestCancellationAtomically(command: RequestRunCancellationCommand): Promise<RequestRunCancellationResult>
	{
		if (!_CancellationCommandIsValid(command)) return { status: "conflict", reason: "invalid_request" };
		const config = this.config;
		const now = this.now();
		return this.prisma.$transaction(async function _cancel(transaction: Prisma.TransactionClient): Promise<RequestRunCancellationResult>
		{
			// 1. Read every authority fact and classify replay before performing writes.
			const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
			if (run === null) return { status: "not_found" };
			if (run.attempt !== command.expectedAttempt) return { status: "conflict", reason: "attempt_conflict" };
			if (run.state === AgentRunState.Cancelling || run.state === AgentRunState.Cancelled)
			{
				return { status: "idempotent", runId: run.id, attempt: run.attempt, state: run.state === AgentRunState.Cancelling ? "cancelling" : "cancelled" };
			}
			if (run.state === AgentRunState.Completed || run.state === AgentRunState.Failed) return { status: "conflict", reason: "terminal_run" };
			const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			const task = await PrismaAgentRunWorkflowTaskRepository.__ReadBoundTask(transaction, run.id, run.attempt);
			const service = await transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
			if (service === null || task === null || task.taskId === null || task.runId !== run.id || task.attempt !== run.attempt || task.siloId !== run.siloId)
			{
				return { status: "conflict", reason: "authority_conflict" };
			}

			// 2. Cancelling is the immediate product-authority fence; physical cleanup may follow later.
			const entered = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: run.state }, data: { state: AgentRunState.Cancelling } });
			if (entered.count !== 1) throw new Error("run cancellation lost its lifecycle fence");
			await transaction.workloadAssignment.updateMany({ where: { runId: run.id, attempt: run.attempt, state: { in: [WorkloadAssignmentState.PendingPod, WorkloadAssignmentState.Registered] } }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
			await transaction.runProofKey.updateMany({ where: { runId: run.id, attempt: run.attempt, revokedAt: null }, data: { revokedAt: now } });
			await __CancelPendingRunApprovalAuthority(transaction, { runId: run.id, attempt: run.attempt, now });
			// 3. Record the cancellation request. The warm workflow owns Deployment cleanup and finalization;
			// the retained cleanup worker receives only an exact legacy Job assignment.
			const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			let sequence = (maximum._max.sequence ?? 0) + 1;
			await transaction.outboxEvent.create({ data: { runId: run.id, attempt: run.attempt, sequence, kind: RunOutboxEventKind.RunCancellationRequested, idempotencyKey: `${run.id}:cancellation:${run.attempt}`, payload: { runId: run.id, attempt: run.attempt, requestedBy: command.requestedBy }, availableAt: now } });
			if (assignment?.workloadKind !== WorkloadKind.Job)
			{
				return { status: "cancelling", runId: run.id, attempt: run.attempt, cleanupRequired: true };
			}
			const runtimeNamespace = _RuntimeNamespace(service.kind, config);
			const bootstrapReference = bootstrap?.id ?? __AgentRunWorkflowBootstrapReference({ taskId: task.taskId, runId: task.runId, attempt: task.attempt, siloId: task.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, inputSnapshotDigest: run.inputSnapshotDigest });
			const cleanup = _CleanupProjection(run, assignment, bootstrapReference, service.workloadProfile, runtimeNamespace, "cancellation");
			sequence += 1;
			const availableAt = assignment === null ? new Date(now.getTime() + config.claimLeaseMilliseconds + config.orphanObservationMarginMilliseconds) : now;
			await transaction.outboxEvent.create({ data: { runId: run.id, attempt: run.attempt, sequence, kind: RunOutboxEventKind.RunWorkloadCleanupRequested, idempotencyKey: `${run.id}:cleanup:${run.attempt}`, payload: cleanup as unknown as Prisma.InputJsonObject, availableAt } });
			return { status: "cancelling", runId: run.id, attempt: run.attempt, cleanupRequired: true };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Claims one cleanup event after its safety horizon and revalidates its run authority. */
	async claimNextWorkloadCleanupAtomically(): Promise<ClaimNextRunWorkloadCleanupResult>
	{
		const config = this.config;
		const now = this.now();
		const leaseExpiredBefore = new Date(now.getTime() - config.claimLeaseMilliseconds);
		return this.prisma.$transaction(async function _claim(transaction: Prisma.TransactionClient): Promise<ClaimNextRunWorkloadCleanupResult>
		{
			const event = await transaction.outboxEvent.findFirst({
				where: { kind: RunOutboxEventKind.RunWorkloadCleanupRequested, publishedAt: null, failedAt: null, availableAt: { lte: now }, OR: [{ claimedAt: null }, { claimedAt: { lte: leaseExpiredBefore } }] },
				orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
			});
			if (!event) return { status: "none" };
			const run = await transaction.agentRun.findUnique({ where: { id: event.runId } });
			const workload = _ParseCleanupProjection(event?.payload);
			if (!run || !workload || !_CleanupClaimIsCurrent(event, run, workload, now, config.claimLeaseMilliseconds)) return { status: "none" };
			const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
			const deliveryCount = event.deliveryCount + 1;
			const claimed = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount } });
			if (claimed.count !== 1) throw new Error("run workload cleanup lost its event fence");
			return { status: "claimed", claim: { lease: { eventId: event.id, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + config.claimLeaseMilliseconds).toISOString() }, workload } };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Confirms exact physical cleanup and finalises a cancelling run only after that evidence commits. */
	async confirmWorkloadCleanupAtomically(eventId: string, command: ConfirmRunWorkloadCleanupCommand): Promise<ConfirmRunWorkloadCleanupResult>
	{
		if (!_ConfirmationIsValid(eventId, command)) return { status: "conflict", reason: "invalid_confirmation" };
		const config = this.config;
		const now = this.now();
		return this.prisma.$transaction(async function _confirm(transaction: Prisma.TransactionClient): Promise<ConfirmRunWorkloadCleanupResult>
		{
			const event = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			if (!event) return { status: "conflict", reason: "claim_not_found" };
			const run = await transaction.agentRun.findUnique({ where: { id: event.runId } });
			const workload = _ParseCleanupProjection(event?.payload);
			if (!run || !workload || !_ConfirmationMatches(event, workload, command)) return { status: "conflict", reason: "authority_conflict" };
			const runFinalized = workload.reason === "cancellation";
			if (event.publishedAt !== null) return { status: "idempotent", runId: run.id, attempt: event.attempt, runFinalized: run.state === AgentRunState.Cancelled };
			if (event.failedAt !== null) return { status: "conflict", reason: "claim_terminal" };
			if (event.claimedAt?.getTime() !== Date.parse(command.claimedAt) || event.deliveryCount !== command.deliveryCount) return { status: "conflict", reason: "stale_claim" };
			if (runFinalized && run.state !== AgentRunState.Cancelling) return { status: "conflict", reason: "authority_conflict" };
			if (runFinalized)
			{
				const cancellation = await __CancelPendingRunApprovalAuthority(transaction, { runId: run.id, attempt: run.attempt, now });
				if (cancellation.activeClaimCount > 0)
				{
					const deferred = await new PrismaRunCancellationEventDeferralUnitOfWork(transaction).defer({ eventId: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, availableAt: new Date(now.getTime() + config.orphanObservationMarginMilliseconds) });
					if (!deferred) throw new Error("run workload cleanup lost its active-claim deferral fence");
					return { status: "confirmed", runId: run.id, attempt: event.attempt, runFinalized: false };
				}
			}
			const published = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { publishedAt: now } });
			if (published.count !== 1) throw new Error("run workload cleanup lost its confirmation fence");
			if (runFinalized) await _FinalizeCancelledRun(transaction, run, now);
			return { status: "confirmed", runId: run.id, attempt: event.attempt, runFinalized };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Persist the first orphan absence and force a second observation after the full create horizon. */
	async deferUnassignedOrphanAbsenceAtomically(eventId: string, claim: RunWorkloadCleanupClaim): Promise<"deferred" | "conflict">
	{
		const config = this.config;
		const now = this.now();
		return this.prisma.$transaction(async function _defer(transaction: Prisma.TransactionClient): Promise<"deferred" | "conflict">
		{
			const event = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			if (!event || event.runId !== claim.workload.runId || event.attempt !== claim.workload.attempt) return "conflict";
			const workload = _ParseCleanupProjection(event.payload);
			if (!workload || workload.mode !== "unassigned_orphan" || workload.orphanAbsenceObservedAt !== null || event.claimedAt?.getTime() !== Date.parse(claim.lease.claimedAt) || event.deliveryCount !== claim.lease.deliveryCount || event.publishedAt !== null || event.failedAt !== null) return "conflict";
			const payload = { ...workload, orphanAbsenceObservedAt: now.toISOString() };
			const deferred = await new PrismaRunCancellationEventDeferralUnitOfWork(transaction).defer({ eventId, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, availableAt: new Date(now.getTime() + config.orphanObservationMarginMilliseconds), payload });
			return deferred ? "deferred" : "conflict";
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

}

/** Validate repository configuration before it reaches SQL or Kubernetes coordinates. */
function _ConfigIsValid(config: RunCancellationRepositoryConfig): boolean
{
	return _IsNamespace(config.personalRuntimeNamespace)
		&& _IsNamespace(config.managedRuntimeNamespace)
		&& config.personalRuntimeNamespace !== config.managedRuntimeNamespace
		&& Number.isSafeInteger(config.claimLeaseMilliseconds) && config.claimLeaseMilliseconds >= 1_000 && config.claimLeaseMilliseconds <= 300_000
		&& Number.isSafeInteger(config.orphanObservationMarginMilliseconds) && config.orphanObservationMarginMilliseconds >= 1_000 && config.orphanObservationMarginMilliseconds <= 60_000;
}

/** Resolve the only runtime namespace authorized for one immutable service kind. */
function _RuntimeNamespace(kind: AgentServiceKind, config: RunCancellationRepositoryConfig): string
{
	return kind === AgentServiceKind.Managed ? config.managedRuntimeNamespace : config.personalRuntimeNamespace;
}

/** Return whether one value is a bounded Kubernetes namespace. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/** Reject malformed cancellation coordinates before opening a transaction. */
function _CancellationCommandIsValid(command: RequestRunCancellationCommand): boolean
{
	return command.runId.length > 0 && command.runId.length <= 256 && Number.isSafeInteger(command.expectedAttempt) && command.expectedAttempt > 0 && command.requestedBy.length > 0 && command.requestedBy.length <= 512;
}

/** Build the durable cleanup payload from run authority rather than caller input. */
function _CleanupProjection(run: AgentRun, assignment: WorkloadAssignment | null, bootstrapReference: string, workloadProfile: string, namespace: string, reason: RunWorkloadCleanupProjection["reason"]): RunWorkloadCleanupProjection
{
	return { runId: run.id, attempt: run.attempt, siloId: run.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, namespace: assignment?.namespace ?? namespace, workloadProfile: assignment?.workloadProfile ?? workloadProfile, bootstrapReference, workloadUid: assignment?.workloadUid ?? null, mode: assignment === null ? "unassigned_orphan" : "assigned", reason, orphanAbsenceObservedAt: null };
}

/** Parse one internally persisted cleanup payload without trusting arbitrary JSON. */
function _ParseCleanupProjection(value: Prisma.JsonValue | undefined): RunWorkloadCleanupProjection | null
{
	if (!value || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const item = value as Record<string, Prisma.JsonValue>;
	if (typeof item["runId"] !== "string" || typeof item["attempt"] !== "number" || typeof item["siloId"] !== "string" || typeof item["agentServiceId"] !== "string" || typeof item["agentRevisionId"] !== "string" || typeof item["namespace"] !== "string" || typeof item["workloadProfile"] !== "string" || typeof item["bootstrapReference"] !== "string") return null;
	if (item["workloadUid"] !== null && typeof item["workloadUid"] !== "string") return null;
	if (item["mode"] !== "assigned" && item["mode"] !== "unassigned_orphan") return null;
	if (item["reason"] !== "cancellation" && item["reason"] !== "dispatch_failure" && item["reason"] !== "runtime_lease_expired" && item["reason"] !== "workflow_terminal_failure")
	{
		return null;
	}
	if (item["orphanAbsenceObservedAt"] !== undefined && item["orphanAbsenceObservedAt"] !== null && typeof item["orphanAbsenceObservedAt"] !== "string") return null;
	return { runId: item["runId"], attempt: item["attempt"], siloId: item["siloId"], agentServiceId: item["agentServiceId"], agentRevisionId: item["agentRevisionId"], namespace: item["namespace"], workloadProfile: item["workloadProfile"], bootstrapReference: item["bootstrapReference"], workloadUid: item["workloadUid"], mode: item["mode"], reason: item["reason"], orphanAbsenceObservedAt: item["orphanAbsenceObservedAt"] ?? null };
}

/** Re-checks a cleanup event once every lock is held. */
function _CleanupClaimIsCurrent(event: OutboxEvent, run: AgentRun, workload: RunWorkloadCleanupProjection, now: Date, claimLeaseMilliseconds: number): boolean
{
	return event.kind === RunOutboxEventKind.RunWorkloadCleanupRequested && event.runId === run.id && event.attempt === run.attempt && workload.runId === run.id && workload.attempt === run.attempt
		&& event.publishedAt === null && event.failedAt === null && event.availableAt.getTime() <= now.getTime() && (event.claimedAt === null || event.claimedAt.getTime() <= now.getTime() - claimLeaseMilliseconds)
		&& (workload.reason === "dispatch_failure" || workload.reason === "runtime_lease_expired" || workload.reason === "workflow_terminal_failure" || run.state === AgentRunState.Cancelling);
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

/** Moves the run to Cancelled, its only terminal state here, and appends the matching conversation event. */
async function _FinalizeCancelledRun(transaction: Prisma.TransactionClient, run: Pick<AgentRun, "id" | "attempt" | "conversationId">, now: Date): Promise<void>
{
	const finalized = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Cancelling }, data: { state: AgentRunState.Cancelled, terminalReason: AgentRunTerminalReason.UserCancelled, finishedAt: now } });
	if (finalized.count !== 1) throw new Error("run cancellation lost its cleanup confirmation fence");
	await __DeliverChildRunCompletionInTransaction(transaction, { childRunId: run.id });
	if (run.conversationId !== null)
	{
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: "run.cancelled", payload: { terminalReason: "user_cancelled" }, occurredAt: now } });
	}
}
