import { createHash } from "node:crypto";

import { AgentRunState, AgentRunTerminalReason, AgentServiceKind, AgentServiceState, Prisma, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type AgentRun, type OutboxEvent, type PrismaClient, type WorkloadAssignment, type WorkloadBootstrap } from "@prisma/client";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName, type AgentControllerRunAttemptAssignmentCommand, type AgentControllerRunAttemptClaimLease, type AgentControllerRunAttemptProjection, type AgentControllerRunWorkloadRegistrationCommand, type AgentControllerRunWorkloadReleaseProjection } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

import type { AttemptModelKeyIssuer, ClaimNextRunAttemptResult, ClaimNextRunWorkloadReleaseResult, CommitRunAttemptAssignmentResult, PrunePublishedRunOutboxResult, RegisterRunWorkloadPodResult, RunDispatchRepository, RunDispatchRepositoryConfig, RunOutboxCandidateRow, RunWorkloadReleaseCandidateRow } from "./run-dispatch.types.js";

/** Snapshot identity fields required at the dispatch authority boundary. */
interface SnapshotExecutionIdentity
{
	/** User or delegated subject whose authority the runtime exercises. */
	readonly subjectId: string;
	/** Last instant at which the signed fleet-membership evidence remains trusted. */
	readonly fleetMembershipTrustedUntilEpochMilliseconds: number;
}

/** Claim plus the inputs needed to mint the attempt key after the database transaction commits. */
interface ClaimedAttemptWithMintInputs
{
	/** Database-issued claim generation fencing the delivery. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Narrow attempt projection without the transient key, which is attached after minting. */
	readonly attempt: Omit<AgentControllerRunAttemptProjection, "litellmKey">;
	/** Attempt- and delivery-unique alias the minted key is bound to. */
	readonly keyAlias: string;
	/** Single model alias frozen into the snapshot's server-selected route. */
	readonly modelAlias: string;
	/** Positive US-dollar spend ceiling derived from the snapshot's budget policy. */
	readonly maxBudgetUsd: number;
	/** Whole-second key lifetime bounded to the assignment lifetime. */
	readonly expirySeconds: number;
}

/** Transaction outcome: no eligible work, or a claim whose key must be minted outside the lock. */
type ClaimTransactionResult = { readonly status: "none" } | ({ readonly status: "claimed" } & ClaimedAttemptWithMintInputs);

/**
 * Prisma-backed authority for handing one accepted personal run to the Kubernetes controller.
 *
 * Claims use database time plus a monotonically increasing delivery generation, so a controller
 * whose lease expired cannot publish an assignment after a newer replica reclaimed the event. Every
 * commit locks service, run, and outbox authority before creating the immutable PendingPod binding.
 */
export class PrismaRunDispatchRepository implements RunDispatchRepository
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Fixed namespace and database-owned lifetime policy. */
	private readonly config: RunDispatchRepositoryConfig;
	/** App-injected issuer that mints the attempt-scoped model key; the master key stays server-side. */
	private readonly issueAttemptModelKey: AttemptModelKeyIssuer;

	/** Creates a dispatch adapter over canonical Postgres with an injected attempt-key issuer. */
	constructor(prisma: PrismaClient, config: RunDispatchRepositoryConfig, issueAttemptModelKey: AttemptModelKeyIssuer)
	{
		if (!_ConfigIsValid(config)) throw new Error("run dispatch repository requires bounded namespace and lifetimes");
		this.prisma = prisma;
		this.config = config;
		this.issueAttemptModelKey = issueAttemptModelKey;
	}

	/** Claims one eligible event, loads its narrow projection, and mints its transient attempt key. */
	async claimNextAttemptAtomically(): Promise<ClaimNextRunAttemptResult>
	{
		const config = this.config;
		// 1. Claim and project under the database lock; extract the mint inputs frozen on the snapshot.
		const claimed = await this.prisma.$transaction(async function _claim(transaction: Prisma.TransactionClient): Promise<ClaimTransactionResult>
		{
			// 1. Discover without locking, then establish the global service -> run -> outbox order.
			const candidates = await transaction.$queryRaw<RunOutboxCandidateRow[]>(Prisma.sql`
				SELECT event."id" AS "eventId", event."run_id" AS "runId", run."agent_service_id" AS "agentServiceId"
				FROM "run_outbox_events" event
				JOIN "agent_runs" run ON run."id" = event."run_id" AND run."attempt" = event."attempt"
				JOIN "agent_services" service ON service."id" = run."agent_service_id"
				WHERE event."kind" = 'run.attempt_requested'::"RunOutboxEventKind"
				  AND event."published_at" IS NULL AND event."failed_at" IS NULL
				  AND event."available_at" <= clock_timestamp()
				  AND (event."claimed_at" IS NULL OR event."claimed_at" <= clock_timestamp() - (${config.claimLeaseMilliseconds} * interval '1 millisecond'))
				  AND run."state" IN ('accepted'::"AgentRunState", 'queued'::"AgentRunState")
				  AND service."kind" = 'personal'::"AgentServiceKind"
				  AND service."state" = 'active'::"AgentServiceState" AND service."active_revision_id" = run."agent_revision_id"
				  AND NOT EXISTS (SELECT 1 FROM "workload_assignments" assignment WHERE assignment."run_id" = run."id" AND assignment."attempt" = run."attempt")
				ORDER BY event."available_at", event."created_at", event."id"
				LIMIT 1
			`);
			const candidate = candidates[0];
			if (!candidate) return { status: "none" };

			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${candidate.agentServiceId} FOR UPDATE`);
			// ConversationRunEvent appends take this advisory lock before the run row. Preserve the
			// global service -> run-advisory -> run -> outbox order before terminal event creation.
			await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.runId}, 0))`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${candidate.runId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${candidate.eventId} FOR UPDATE`);

			// 2. Reload and revalidate every authority coordinate after all canonical locks are held.
			const service = await transaction.agentService.findUnique({ where: { id: candidate.agentServiceId } });
			const run = await transaction.agentRun.findUnique({ where: { id: candidate.runId } });
			const event = await transaction.outboxEvent.findUnique({ where: { id: candidate.eventId } });
			if (service === null || run === null || event === null) return { status: "none" };
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			if (!now || !_ClaimAuthorityIsCurrent(service, run, event, candidate, now, config.claimLeaseMilliseconds)) return { status: "none" };
			const existing = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			if (existing !== null)
			{
				await _TerminalizeUndispatchableAttempt(transaction, event, run, now, "RUN_DISPATCH_ASSIGNMENT_PREEXISTS", AgentRunTerminalReason.RuntimeFailure);
				return { status: "none" };
			}
			const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: run.id, digest: run.inputSnapshotDigest } } });
			const identity = _SnapshotExecutionIdentity(snapshot?.identitySnapshot);
			if (snapshot === null || identity === null || !_SnapshotMatchesRun(snapshot, run))
			{
				await _TerminalizeUndispatchableAttempt(transaction, event, run, now, "RUN_DISPATCH_SNAPSHOT_INVALID", AgentRunTerminalReason.InvalidInput);
				return { status: "none" };
			}
			if (identity.fleetMembershipTrustedUntilEpochMilliseconds <= now.getTime())
			{
				await _TerminalizeUndispatchableAttempt(transaction, event, run, now, "RUN_DISPATCH_MEMBERSHIP_EXPIRED", AgentRunTerminalReason.PolicyDenied);
				return { status: "none" };
			}

			// 3. Read the frozen model alias and cost ceiling; fail closed when either cannot bound a key.
			const modelAlias = _SnapshotModelAlias(snapshot.modelRoute);
			const maxBudgetUsd = _SnapshotMaxBudgetUsd(snapshot.budgetPolicy);
			if (modelAlias === null || maxBudgetUsd === null)
			{
				await _TerminalizeUndispatchableAttempt(transaction, event, run, now, "RUN_DISPATCH_MODEL_ROUTE_INVALID", AgentRunTerminalReason.InvalidInput);
				return { status: "none" };
			}

			// 4. Advance both claim coordinates. The exact pair fences stale controller replicas.
			const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
			const deliveryCount = event.deliveryCount + 1;
			const claimedEvent = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount } });
			if (claimedEvent.count !== 1) throw new Error("run dispatch claim lost its event fence");
			if (run.state === AgentRunState.Accepted)
			{
				const queued = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Accepted }, data: { state: AgentRunState.Queued } });
				if (queued.count !== 1) throw new Error("claimed run could not enter queued state");
			}

			// 5. Return the claim plus the inputs to mint the transient key once the lock is released.
			return {
				status: "claimed",
				lease: { eventId: event.id, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + config.claimLeaseMilliseconds).toISOString() },
				attempt: { runId: run.id, attempt: run.attempt, siloId: run.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, inputSnapshotDigest: run.inputSnapshotDigest, namespace: config.namespace, workloadProfile: service.workloadProfile, bootstrapReference: _BootstrapReference(event.id, run.attempt, run, config.namespace) },
				keyAlias: _AttemptKeyAlias(run.id, run.attempt, run.siloId, deliveryCount),
				modelAlias,
				maxBudgetUsd,
				expirySeconds: _AttemptKeyExpirySeconds(config.assignmentTtlMilliseconds),
			};
		});
		if (claimed.status === "none") return { status: "none" };

		// 2. Mint the attempt-scoped key OUTSIDE the transaction so no external call holds a database
		//    lock, then attach it transiently to the claim response. It is never written to Postgres.
		const minted = await this.issueAttemptModelKey({ keyAlias: claimed.keyAlias, modelAlias: claimed.modelAlias, siloId: claimed.attempt.siloId, maxBudgetUsd: claimed.maxBudgetUsd, expirySeconds: claimed.expirySeconds });
		if (typeof minted.key !== "string" || minted.key.length === 0) throw new Error("attempt model key issuer returned no key");
		return { status: "claimed", claim: { lease: claimed.lease, attempt: { ...claimed.attempt, litellmKey: minted.key } } };
	}

	/** Remove one bounded batch of delivered operational records while preserving failed evidence. */
	async prunePublishedOutboxEventsAtomically(): Promise<PrunePublishedRunOutboxResult>
	{
		const config = this.config;
		const publishedOutboxRetentionMilliseconds = config.publishedOutboxRetentionMilliseconds ?? 604_800_000;
		const outboxPruneBatchSize = config.outboxPruneBatchSize ?? 100;
		return this.prisma.$transaction(async function _prune(transaction: Prisma.TransactionClient): Promise<PrunePublishedRunOutboxResult>
		{
			// 1. Take database time so the retention boundary is consistent across controller replicas.
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			if (!now) throw new Error("outbox retention could not read database time");
			const cutoff = new Date(now.getTime() - publishedOutboxRetentionMilliseconds);

			// 2. Enable the target-schema trigger's narrow maintenance permission for this transaction only.
			await transaction.$executeRaw(Prisma.sql`SELECT set_config('opencrane.run_outbox_prune', 'true', true)`);

			// 3. Delete only old successful deliveries in deterministic batches; failed records remain evidence.
			const deleted = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
				DELETE FROM "run_outbox_events"
				WHERE "id" IN (
					SELECT "id" FROM "run_outbox_events"
					WHERE "published_at" IS NOT NULL AND "failed_at" IS NULL AND "published_at" < ${cutoff}
					ORDER BY "published_at", "id"
					LIMIT ${outboxPruneBatchSize}
					FOR UPDATE SKIP LOCKED
				)
				RETURNING "id"
			`);
			return { deletedCount: deleted.length };
		});
	}

	/** Commits an exact live claim, immutable Job UID, assignment, run state, and outbox publication. */
	async commitSuspendedJobAssignmentAtomically(eventId: string, command: AgentControllerRunAttemptAssignmentCommand): Promise<CommitRunAttemptAssignmentResult>
	{
		const config = this.config;
		if (!_AssignmentCommandIsValid(eventId, command, config.namespace)) return { status: "conflict", reason: "invalid_assignment" };
		return this.prisma.$transaction(async function _commit(transaction: Prisma.TransactionClient): Promise<CommitRunAttemptAssignmentResult>
		{
			// 1. Pre-read only to discover lock keys. Every value is reloaded after canonical locking.
			const discoveredEvent = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			if (discoveredEvent === null) return { status: "conflict", reason: "claim_not_found" };
			const discoveredRun = await transaction.agentRun.findUnique({ where: { id: discoveredEvent.runId } });
			if (discoveredRun === null) return { status: "conflict", reason: "attempt_conflict" };
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${discoveredRun.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discoveredRun.id} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${eventId} FOR UPDATE`);

			// 2. Reload all rows, database time, and the immutable snapshot under the held locks.
			const service = await transaction.agentService.findUnique({ where: { id: discoveredRun.agentServiceId } });
			const run = await transaction.agentRun.findUnique({ where: { id: discoveredRun.id } });
			const event = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
			if (service === null || run === null || event === null || event.kind !== RunOutboxEventKind.RunAttemptRequested || event.runId !== command.runId || event.attempt !== command.attempt || run.id !== command.runId)
			{
				return { status: "conflict", reason: "attempt_conflict" };
			}
			const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
			const now = databaseTime[0]?.now;
			const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: run.id, digest: run.inputSnapshotDigest } } });
			const identity = _SnapshotExecutionIdentity(snapshot?.identitySnapshot);
			if (!now || snapshot === null || identity === null || !_SnapshotMatchesRun(snapshot, run) || command.bootstrapReference !== _BootstrapReference(event.id, event.attempt, run, config.namespace))
			{
				return { status: "conflict", reason: "authority_conflict" };
			}

			// 3. Replay the durable result independently of later Registered, Revoked, or run lifecycle state.
			const leaseMatches = event.claimedAt !== null && event.claimedAt.getTime() === Date.parse(command.claimedAt) && event.deliveryCount === command.deliveryCount;
			const existing = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: command.attempt } } });
			if (existing !== null)
			{
				const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { id: command.bootstrapReference } });
				const release = await transaction.outboxEvent.findUnique({ where: { idempotencyKey: _ReleaseIdempotencyKey(run.id, command.attempt) } });
				if (leaseMatches && event.publishedAt !== null && _AssignmentIdentityMatches(existing, command, run, identity.subjectId) && _BootstrapMatches(bootstrap, command.bootstrapReference, existing) && _ReleaseEventMatches(release, existing, command.bootstrapReference))
				{
					return { status: "committed", result: { outcome: "idempotent", runId: run.id, attempt: command.attempt, workloadUid: existing.workloadUid } };
				}
				return { status: "conflict", reason: "assignment_conflict" };
			}

			// 4. Require the exact unexpired database claim generation before authoritative writes begin.
			if (identity.fleetMembershipTrustedUntilEpochMilliseconds <= now.getTime() || service.id !== run.agentServiceId || service.kind !== AgentServiceKind.Personal || service.state !== AgentServiceState.Active || service.siloId !== run.siloId || service.activeRevisionId !== run.agentRevisionId || service.workloadProfile !== command.expectedWorkloadProfile)
			{
				return { status: "conflict", reason: "authority_conflict" };
			}
			if (event.publishedAt !== null || event.failedAt !== null) return { status: "conflict", reason: "claim_terminal" };
			if (!leaseMatches || now.getTime() >= event.claimedAt!.getTime() + config.claimLeaseMilliseconds) return { status: "conflict", reason: "stale_claim" };
			if (run.attempt !== command.attempt || run.state !== AgentRunState.Queued) return { status: "conflict", reason: "attempt_conflict" };

			// 5. Insert the immutable PendingPod assignment before advancing the run authority.
			const createdAt = now;
			const expiresAt = new Date(Math.min(now.getTime() + config.assignmentTtlMilliseconds, identity.fleetMembershipTrustedUntilEpochMilliseconds));
			const assignment = await transaction.workloadAssignment.create({ data: {
				runId: run.id,
				attempt: run.attempt,
				agentServiceId: run.agentServiceId,
				agentRevisionId: run.agentRevisionId,
				siloId: run.siloId,
				subjectId: identity.subjectId,
				audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE,
				serviceAccountName: command.serviceAccountName,
				namespace: command.namespace,
				workloadKind: WorkloadKind.Job,
				workloadUid: command.workloadUid,
				workloadProfile: command.expectedWorkloadProfile,
				state: WorkloadAssignmentState.PendingPod,
				expiresAt,
				createdAt,
			} });

			// 6. Enter Assigned before creating the bootstrap because the database trigger requires it.
			const assigned = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Queued }, data: { state: AgentRunState.Assigned } });
			if (assigned.count !== 1) throw new Error("run assignment commit lost its run fence");

			// 7. Create an unconsumed integrity row; the opaque reference is not secret-possession evidence.
			await transaction.workloadBootstrap.create({ data: {
				id: command.bootstrapReference,
				runId: run.id,
				attempt: run.attempt,
				agentServiceId: run.agentServiceId,
				agentRevisionId: run.agentRevisionId,
				siloId: run.siloId,
				subjectId: identity.subjectId,
				audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE,
				serviceAccountName: command.serviceAccountName,
				namespace: command.namespace,
				workloadKind: WorkloadKind.Job,
				workloadUid: command.workloadUid,
				claimDigest: _BootstrapClaimDigest(command.bootstrapReference, assignment),
				expiresAt,
				createdAt,
			} });

			// 8. Append one release command after the attempt request without colliding across retries.
			const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			await transaction.outboxEvent.create({ data: {
				runId: run.id,
				attempt: run.attempt,
				sequence: (maximum._max.sequence ?? 0) + 1,
				kind: RunOutboxEventKind.RunWorkloadReleaseRequested,
				idempotencyKey: _ReleaseIdempotencyKey(run.id, run.attempt),
				payload: _ReleasePayload(assignment, command.bootstrapReference),
				availableAt: now,
			} });

			// 9. Publish only the attempt event; release remains recoverably claimable until Pod registration.
			const published = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { publishedAt: now } });
			if (published.count !== 1) throw new Error("run assignment commit lost its outbox claim fence");
			return { status: "committed", result: { outcome: "assigned", runId: run.id, attempt: run.attempt, workloadUid: command.workloadUid } };
		});
	}

	/** Claims one live PendingPod assignment without consulting mutable workload-profile policy. */
	async claimNextWorkloadReleaseAtomically(): Promise<ClaimNextRunWorkloadReleaseResult>
	{
		const config = this.config;
		const prisma = this.prisma;
		return ___DoWithTrace("run_dispatch.workload_release.claim", { namespace: config.namespace }, async function _traceReleaseClaim(): Promise<ClaimNextRunWorkloadReleaseResult>
		{
			return prisma.$transaction(async function _claimRelease(transaction: Prisma.TransactionClient): Promise<ClaimNextRunWorkloadReleaseResult>
			{
				// 1. Include expired authority so the oldest poisoned row can be repaired before later work.
				const candidates = await transaction.$queryRaw<RunWorkloadReleaseCandidateRow[]>(Prisma.sql`
					SELECT event."id" AS "eventId", event."run_id" AS "runId", event."attempt" AS "attempt", run."agent_service_id" AS "agentServiceId", bootstrap."id" AS "bootstrapReference"
					FROM "run_outbox_events" event
					JOIN "agent_runs" run ON run."id" = event."run_id" AND run."attempt" = event."attempt"
					JOIN "workload_assignments" assignment ON assignment."run_id" = run."id" AND assignment."attempt" = run."attempt"
					JOIN "workload_bootstraps" bootstrap ON bootstrap."run_id" = assignment."run_id" AND bootstrap."attempt" = assignment."attempt"
					WHERE event."kind" = 'run.workload_release_requested'::"RunOutboxEventKind"
					  AND event."published_at" IS NULL AND event."failed_at" IS NULL
					  AND event."available_at" <= clock_timestamp()
					  AND (event."claimed_at" IS NULL OR event."claimed_at" <= clock_timestamp() - (${config.claimLeaseMilliseconds} * interval '1 millisecond'))
				  AND run."state" = 'assigned'::"AgentRunState"
				  AND assignment."state" = 'pending_pod'::"WorkloadAssignmentState"
				  AND bootstrap."consumed_at" IS NULL
					ORDER BY event."available_at", event."created_at", event."id"
					LIMIT 1
				`);
				const candidate = candidates[0];
				if (!candidate) return { status: "none" };


				// 2. Lock service, run, assignment, bootstrap, then outbox in the shared authority order.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${candidate.agentServiceId} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.runId}, 0))`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${candidate.runId} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${candidate.runId} AND "attempt" = ${candidate.attempt} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "workload_bootstraps" WHERE "id" = ${candidate.bootstrapReference} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${candidate.eventId} FOR UPDATE`);


				// 3. Reload and verify the complete durable binding with database time under those locks.
				const event = await transaction.outboxEvent.findUnique({ where: { id: candidate.eventId } });
				const run = await transaction.agentRun.findUnique({ where: { id: candidate.runId } });
				if (event === null || run === null) return { status: "none" };
				const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: event.attempt } } });
				const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { id: candidate.bootstrapReference } });
				const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
				const now = databaseTime[0]?.now;
				if (!now) return { status: "none" };
				if (!_ReleaseAuthorityIsCurrent(event, run, assignment, bootstrap, candidate, now, config.claimLeaseMilliseconds))
				{
					const failureCode = _ReleasePoisonFailureCode(event, run, assignment, bootstrap, candidate, now, config.claimLeaseMilliseconds);
					if (failureCode !== null)
					{
						await _TerminalizePoisonedRelease(transaction, event, run, assignment, bootstrap, now, failureCode);
						return { status: "terminalized", eventId: event.id, runId: run.id, attempt: event.attempt, failureCode };
					}
					return { status: "none" };
				}


				// 4. Advance the release claim generation so a crashed controller can be safely replaced.
				const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
				const deliveryCount = event.deliveryCount + 1;
				const claimed = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount } });
				if (claimed.count !== 1) throw new Error("run workload release lost its event fence");


				return {
					status: "claimed",
					claim: {
						lease: { eventId: event.id, claimedAt: claimedAt.toISOString(), deliveryCount, expiresAt: new Date(claimedAt.getTime() + config.claimLeaseMilliseconds).toISOString() },
						workload: _ReleaseProjection(assignment!, bootstrap!.id),
					},
				};
			});
		});
	}

	/** Registers exactly one Pod and publishes the release event in the same transaction. */
	async registerFirstPodAndPublishReleaseAtomically(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand): Promise<RegisterRunWorkloadPodResult>
	{
		const config = this.config;
		if (!_RegistrationCommandIsValid(eventId, command, config.namespace)) return { status: "conflict", reason: "invalid_registration" };
		const prisma = this.prisma;
		return ___DoWithTrace("run_dispatch.workload_release.register", { eventId, runId: command.runId, attempt: command.attempt, workloadUid: command.workloadUid, podUid: command.podUid }, async function _tracePodRegistration(): Promise<RegisterRunWorkloadPodResult>
		{
			return prisma.$transaction(async function _register(transaction: Prisma.TransactionClient): Promise<RegisterRunWorkloadPodResult>
			{
				// 1. Discover lock keys, then acquire the same service -> run -> assignment -> bootstrap -> outbox order.
				const discoveredEvent = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
				if (discoveredEvent === null) return { status: "conflict", reason: "claim_not_found" };
				const discoveredRun = await transaction.agentRun.findUnique({ where: { id: discoveredEvent.runId } });
				if (discoveredRun === null) return { status: "conflict", reason: "attempt_conflict" };
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${discoveredRun.agentServiceId} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discoveredRun.id} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${command.runId} AND "attempt" = ${command.attempt} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "workload_bootstraps" WHERE "id" = ${command.bootstrapReference} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${eventId} FOR UPDATE`);


				// 2. Reload every durable row and database time after canonical locking.
				const event = await transaction.outboxEvent.findUnique({ where: { id: eventId } });
				const run = await transaction.agentRun.findUnique({ where: { id: discoveredRun.id } });
				const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: command.runId, attempt: command.attempt } } });
				const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { id: command.bootstrapReference } });
				const databaseTime = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp()::timestamp(3) AS "now"`);
				const now = databaseTime[0]?.now;
				if (!now || event === null || run === null || assignment === null || bootstrap === null || event.kind !== RunOutboxEventKind.RunWorkloadReleaseRequested || event.runId !== command.runId || event.attempt !== command.attempt || run.id !== command.runId)
				{
					return { status: "conflict", reason: "attempt_conflict" };
				}


				// 3. Exact registration replay wins before terminal-event checks; another Pod is permanent conflict.
				const leaseMatches = event.claimedAt !== null && event.claimedAt.getTime() === Date.parse(command.claimedAt) && event.deliveryCount === command.deliveryCount;
				if (assignment.state === WorkloadAssignmentState.Registered || assignment.state === WorkloadAssignmentState.Revoked)
				{
					if (assignment.podUid !== command.podUid) return { status: "conflict", reason: "pod_conflict" };
					if (leaseMatches && event.publishedAt !== null && _RegistrationMatches(assignment, bootstrap, event, command))
					{
						return { status: "registered", result: { outcome: "idempotent", runId: run.id, attempt: command.attempt, workloadUid: assignment.workloadUid, podUid: assignment.podUid } };
					}
					return { status: "conflict", reason: "assignment_conflict" };
				}


				// 4. Require live exact assignment integrity before inspecting the recoverable release lease.
				if (run.attempt !== command.attempt || run.state !== AgentRunState.Assigned || assignment.state !== WorkloadAssignmentState.PendingPod || !_RegistrationMatches(assignment, bootstrap, event, command) || assignment.expiresAt.getTime() <= now.getTime() || bootstrap.expiresAt.getTime() <= now.getTime() || bootstrap.consumedAt !== null)
				{
					return { status: "conflict", reason: "authority_conflict" };
				}
				if (event.publishedAt !== null || event.failedAt !== null) return { status: "conflict", reason: "claim_terminal" };
				if (!leaseMatches || now.getTime() >= event.claimedAt!.getTime() + config.claimLeaseMilliseconds) return { status: "conflict", reason: "stale_claim" };


				// 5. Bind the first Pod under the assignment compare-and-swap, then publish only this release.
				const registered = await transaction.workloadAssignment.updateMany({ where: { runId: command.runId, attempt: command.attempt, agentServiceId: command.agentServiceId, agentRevisionId: command.agentRevisionId, siloId: command.siloId, namespace: command.namespace, serviceAccountName: command.serviceAccountName, workloadKind: WorkloadKind.Job, workloadUid: command.workloadUid, workloadProfile: command.workloadProfile, state: WorkloadAssignmentState.PendingPod, podUid: null }, data: { state: WorkloadAssignmentState.Registered, podUid: command.podUid, registeredAt: now } });
				const published = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { publishedAt: now } });
				if (registered.count !== 1 || published.count !== 1) throw new Error("run workload registration lost its release fence");
				return { status: "registered", result: { outcome: "registered", runId: run.id, attempt: run.attempt, workloadUid: assignment.workloadUid, podUid: command.podUid } };
			});
		});
	}
}

/** Terminalise one poisoned dispatch row so it cannot starve every later valid attempt. */
async function _TerminalizeUndispatchableAttempt(transaction: Prisma.TransactionClient, event: { id: string; claimedAt: Date | null; deliveryCount: number }, run: { id: string; attempt: number; threadId: string | null }, now: Date, failureCode: string, terminalReason: AgentRunTerminalReason): Promise<void>
{
	// 1. Fence and terminalise the poisoned outbox command without violating delivery coherence.
	const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
	const failedEvent = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount: event.deliveryCount + 1, failedAt: claimedAt, failureCode } });
	const failedRun = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: { in: [AgentRunState.Accepted, AgentRunState.Queued] } }, data: { state: AgentRunState.Failed, terminalReason, finishedAt: now } });
	if (failedEvent.count !== 1 || failedRun.count !== 1) throw new Error("undispatchable run attempt lost its terminal failure fence");

	// 2. Conversation-bound runs require their contiguous canonical terminal event in this transaction.
	if (run.threadId !== null)
	{
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.conversationRunEvent.create({ data: { runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: "run.failed", payload: { terminalReason: _TerminalReasonPayload(terminalReason), failureCode }, occurredAt: now } });
	}
}

/** Map one Prisma terminal enum to the canonical conversation-event payload value. */
function _TerminalReasonPayload(value: AgentRunTerminalReason): string
{
	if (value === AgentRunTerminalReason.PolicyDenied) return "policy_denied";
	if (value === AgentRunTerminalReason.RuntimeFailure) return "runtime_failure";
	if (value === AgentRunTerminalReason.InvalidInput) return "invalid_input";
	throw new Error("run dispatch emitted an unsupported terminal reason");
}

/** Validate fixed repository policy before any database transaction begins. */
function _ConfigIsValid(config: RunDispatchRepositoryConfig): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(config.namespace)
		&& config.namespace.length <= 63
		&& Number.isSafeInteger(config.claimLeaseMilliseconds) && config.claimLeaseMilliseconds >= 1_000 && config.claimLeaseMilliseconds <= 300_000
		&& Number.isSafeInteger(config.assignmentTtlMilliseconds) && config.assignmentTtlMilliseconds >= 60_000 && config.assignmentTtlMilliseconds <= 86_400_000
		&& (config.publishedOutboxRetentionMilliseconds === undefined || (Number.isSafeInteger(config.publishedOutboxRetentionMilliseconds) && config.publishedOutboxRetentionMilliseconds >= 3_600_000 && config.publishedOutboxRetentionMilliseconds <= 7_776_000_000))
		&& (config.outboxPruneBatchSize === undefined || (Number.isSafeInteger(config.outboxPruneBatchSize) && config.outboxPruneBatchSize >= 1 && config.outboxPruneBatchSize <= 1_000));
}

/** Revalidate one discovered claim candidate after all authority locks are held. */
function _ClaimAuthorityIsCurrent(service: { id: string; kind: AgentServiceKind; state: AgentServiceState; siloId: string; activeRevisionId: string | null }, run: { id: string; attempt: number; state: AgentRunState; siloId: string; agentServiceId: string; agentRevisionId: string }, event: { id: string; runId: string; attempt: number; kind: RunOutboxEventKind; availableAt: Date; claimedAt: Date | null; publishedAt: Date | null; failedAt: Date | null }, candidate: RunOutboxCandidateRow, now: Date, claimLeaseMilliseconds: number): boolean
{
	return service.id === candidate.agentServiceId && run.id === candidate.runId && event.id === candidate.eventId
		&& run.agentServiceId === service.id && run.siloId === service.siloId
		&& event.runId === run.id && event.attempt === run.attempt && event.kind === RunOutboxEventKind.RunAttemptRequested
		&& event.publishedAt === null && event.failedAt === null && event.availableAt.getTime() <= now.getTime()
		&& (event.claimedAt === null || event.claimedAt.getTime() <= now.getTime() - claimLeaseMilliseconds)
		&& (run.state === AgentRunState.Accepted || run.state === AgentRunState.Queued)
		&& service.kind === AgentServiceKind.Personal && service.state === AgentServiceState.Active && service.activeRevisionId === run.agentRevisionId;
}

/** Validate untrusted assignment evidence before it reaches Prisma or SQL. */
function _AssignmentCommandIsValid(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, namespace: string): boolean
{
	return eventId.trim().length > 0 && eventId.length <= 256
		&& command.runId.trim().length > 0 && command.runId.length <= 256
		&& Number.isSafeInteger(command.attempt) && command.attempt > 0
		&& Number.isSafeInteger(command.deliveryCount) && command.deliveryCount > 0
		&& _CanonicalUtcInstantEpochMilliseconds(command.claimedAt) !== null
		&& command.expectedWorkloadProfile.trim().length > 0 && command.expectedWorkloadProfile.length <= 128
		&& /^bootstrap-v1_[0-9a-f]{64}$/.test(command.bootstrapReference)
		&& command.namespace === namespace
		&& ___IsAgentRuntimeServiceAccountName(command.serviceAccountName)
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.workloadUid);
}

/** Parse the trusted subject and signed-membership lifetime from immutable snapshot JSON. */
function _SnapshotExecutionIdentity(value: unknown): SnapshotExecutionIdentity | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const identity = value as Record<string, unknown>;
	const subjectId = identity["executionSubjectId"];
	const trustedUntil = identity["fleetMembershipTrustedUntil"];
	if (typeof subjectId !== "string" || subjectId.trim().length === 0 || subjectId.length > 256 || typeof trustedUntil !== "string") return null;
	const fleetMembershipTrustedUntilEpochMilliseconds = _CanonicalUtcInstantEpochMilliseconds(trustedUntil);
	return fleetMembershipTrustedUntilEpochMilliseconds === null ? null : { subjectId, fleetMembershipTrustedUntilEpochMilliseconds };
}

/** Parse the sole canonical UTC ISO-8601 representation used by snapshot and lease contracts. */
function _CanonicalUtcInstantEpochMilliseconds(value: string): number | null
{
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
	const epochMilliseconds = Date.parse(value);
	return Number.isFinite(epochMilliseconds) && new Date(epochMilliseconds).toISOString() === value ? epochMilliseconds : null;
}

/** Require the persisted snapshot to repeat every immutable run authority coordinate exactly. */
function _SnapshotMatchesRun(snapshot: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; effectiveContractDigest: string; digest: string; threadId: string | null }, run: { id: string; siloId: string; agentServiceId: string; agentRevisionId: string; effectiveContractDigest: string; inputSnapshotDigest: string; threadId: string | null }): boolean
{
	return snapshot.runId === run.id && snapshot.siloId === run.siloId && snapshot.agentServiceId === run.agentServiceId && snapshot.agentRevisionId === run.agentRevisionId && snapshot.effectiveContractDigest === run.effectiveContractDigest && snapshot.digest === run.inputSnapshotDigest && snapshot.threadId === run.threadId;
}

/** Compare an existing immutable assignment with the complete canonical command and run authority. */
function _AssignmentIdentityMatches(existing: { runId: string; attempt: number; agentServiceId: string; agentRevisionId: string; siloId: string; subjectId: string; audience: string; serviceAccountName: string; namespace: string; workloadKind: WorkloadKind; workloadUid: string; workloadProfile: string }, command: AgentControllerRunAttemptAssignmentCommand, run: { id: string; agentServiceId: string; agentRevisionId: string; siloId: string }, subjectId: string): boolean
{
	return existing.runId === run.id && existing.attempt === command.attempt && existing.agentServiceId === run.agentServiceId && existing.agentRevisionId === run.agentRevisionId && existing.siloId === run.siloId && existing.subjectId === subjectId && existing.audience === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE && existing.serviceAccountName === command.serviceAccountName && existing.namespace === command.namespace && existing.workloadKind === WorkloadKind.Job && existing.workloadUid === command.workloadUid && existing.workloadProfile === command.expectedWorkloadProfile;
}

/** Derive a stable non-secret reference from immutable attempt authority. */
function _BootstrapReference(eventId: string, attempt: number, run: Pick<AgentRun, "id" | "siloId" | "agentServiceId" | "agentRevisionId" | "inputSnapshotDigest">, namespace: string): string
{
	const canonical = JSON.stringify(["opencrane-workload-bootstrap-reference-v1", eventId, run.id, attempt, run.siloId, run.agentServiceId, run.agentRevisionId, run.inputSnapshotDigest, namespace]);
	return `bootstrap-v1_${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Bind the opaque reference to every immutable assignment field with a canonical digest. */
function _BootstrapClaimDigest(bootstrapReference: string, assignment: WorkloadAssignment): string
{
	const canonical = JSON.stringify([
		"opencrane-workload-bootstrap-integrity-v1",
		bootstrapReference,
		assignment.runId,
		assignment.attempt,
		assignment.agentServiceId,
		assignment.agentRevisionId,
		assignment.siloId,
		assignment.subjectId,
		assignment.audience,
		assignment.serviceAccountName,
		assignment.namespace,
		assignment.workloadKind,
		assignment.workloadUid,
		assignment.workloadProfile,
		assignment.expiresAt.toISOString(),
		assignment.createdAt.toISOString(),
	]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Build the immutable release payload recorded in the run outbox. */
function _ReleasePayload(assignment: WorkloadAssignment, bootstrapReference: string): Prisma.InputJsonObject
{
	return {
		runId: assignment.runId,
		attempt: assignment.attempt,
		siloId: assignment.siloId,
		agentServiceId: assignment.agentServiceId,
		agentRevisionId: assignment.agentRevisionId,
		namespace: assignment.namespace,
		serviceAccountName: assignment.serviceAccountName,
		workloadUid: assignment.workloadUid,
		workloadProfile: assignment.workloadProfile,
		assignmentExpiresAt: assignment.expiresAt.toISOString(),
		bootstrapReference,
	};
}

/** Map a durable assignment into the narrow controller release projection. */
function _ReleaseProjection(assignment: WorkloadAssignment, bootstrapReference: string): AgentControllerRunWorkloadReleaseProjection
{
	return {
		runId: assignment.runId,
		attempt: assignment.attempt,
		siloId: assignment.siloId,
		agentServiceId: assignment.agentServiceId,
		agentRevisionId: assignment.agentRevisionId,
		namespace: assignment.namespace,
		serviceAccountName: assignment.serviceAccountName,
		workloadUid: assignment.workloadUid,
		workloadProfile: assignment.workloadProfile,
		assignmentExpiresAt: assignment.expiresAt.toISOString(),
		bootstrapReference,
	};
}

/** Build the per-attempt idempotency key for its sole workload-release command. */
function _ReleaseIdempotencyKey(runId: string, attempt: number): string
{
	return `${runId}:attempt:${attempt}:workload-release`;
}

/** Verify bootstrap identity, assignment coordinates, lifetime, and canonical integrity digest. */
function _BootstrapMatches(bootstrap: WorkloadBootstrap | null, bootstrapReference: string, assignment: WorkloadAssignment): boolean
{
	return bootstrap !== null
		&& bootstrap.id === bootstrapReference
		&& bootstrap.runId === assignment.runId
		&& bootstrap.attempt === assignment.attempt
		&& bootstrap.agentServiceId === assignment.agentServiceId
		&& bootstrap.agentRevisionId === assignment.agentRevisionId
		&& bootstrap.siloId === assignment.siloId
		&& bootstrap.subjectId === assignment.subjectId
		&& bootstrap.audience === assignment.audience
		&& bootstrap.serviceAccountName === assignment.serviceAccountName
		&& bootstrap.namespace === assignment.namespace
		&& bootstrap.workloadKind === assignment.workloadKind
		&& bootstrap.workloadUid === assignment.workloadUid
		&& bootstrap.expiresAt.getTime() === assignment.expiresAt.getTime()
		&& bootstrap.createdAt.getTime() === assignment.createdAt.getTime()
		&& bootstrap.claimDigest === _BootstrapClaimDigest(bootstrapReference, assignment);
}

/** Verify that one outbox row carries the exact immutable release projection. */
function _ReleaseEventMatches(event: OutboxEvent | null, assignment: WorkloadAssignment, bootstrapReference: string): boolean
{
	if (event === null || event.kind !== RunOutboxEventKind.RunWorkloadReleaseRequested || event.runId !== assignment.runId || event.attempt !== assignment.attempt || event.idempotencyKey !== _ReleaseIdempotencyKey(assignment.runId, assignment.attempt)) return false;
	if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return false;
	const payload = event.payload as Record<string, unknown>;
	const expected = _ReleasePayload(assignment, bootstrapReference);
	const keys = Object.keys(expected);
	return Object.keys(payload).length === keys.length && keys.every(key => payload[key] === expected[key]);
}

/** Revalidate an eligible release row after canonical locking and with database time. */
function _ReleaseAuthorityIsCurrent(event: OutboxEvent, run: AgentRun, assignment: WorkloadAssignment | null, bootstrap: WorkloadBootstrap | null, candidate: RunWorkloadReleaseCandidateRow, now: Date, claimLeaseMilliseconds: number): boolean
{
	return assignment !== null && bootstrap !== null
		&& candidate.eventId === event.id && candidate.runId === run.id && candidate.attempt === event.attempt && candidate.agentServiceId === run.agentServiceId && candidate.bootstrapReference === bootstrap.id
		&& event.kind === RunOutboxEventKind.RunWorkloadReleaseRequested && event.runId === run.id && event.attempt === run.attempt
		&& event.publishedAt === null && event.failedAt === null && event.availableAt.getTime() <= now.getTime()
		&& (event.claimedAt === null || event.claimedAt.getTime() <= now.getTime() - claimLeaseMilliseconds)
		&& run.state === AgentRunState.Assigned
		&& assignment.runId === run.id && assignment.attempt === run.attempt && assignment.agentServiceId === run.agentServiceId && assignment.agentRevisionId === run.agentRevisionId && assignment.siloId === run.siloId
		&& assignment.state === WorkloadAssignmentState.PendingPod && assignment.podUid === null && assignment.expiresAt.getTime() > now.getTime()
		&& bootstrap.consumedAt === null && bootstrap.expiresAt.getTime() > now.getTime()
		&& _BootstrapMatches(bootstrap, bootstrap.id, assignment) && _ReleaseEventMatches(event, assignment, bootstrap.id);
}

/** Classify only persistent release poison; a concurrent fresh claim is a benign retry race. */
function _ReleasePoisonFailureCode(event: OutboxEvent, run: AgentRun, assignment: WorkloadAssignment | null, bootstrap: WorkloadBootstrap | null, candidate: RunWorkloadReleaseCandidateRow, now: Date, claimLeaseMilliseconds: number): string | null
{
	if (event.publishedAt !== null || event.failedAt !== null) return null;
	if (event.claimedAt !== null && event.claimedAt.getTime() > now.getTime() - claimLeaseMilliseconds) return null;
	if (run.state !== AgentRunState.Assigned) return null;
	if (assignment !== null && (assignment.state !== WorkloadAssignmentState.PendingPod || assignment.podUid !== null)) return null;
	if (bootstrap !== null && bootstrap.consumedAt !== null) return null;
	if (assignment === null || bootstrap === null) return "RUN_WORKLOAD_RELEASE_AUTHORITY_MISSING";
	if (assignment.expiresAt.getTime() <= now.getTime() || bootstrap.expiresAt.getTime() <= now.getTime()) return "RUN_WORKLOAD_RELEASE_AUTHORITY_EXPIRED";
	if (candidate.eventId !== event.id || candidate.runId !== run.id || candidate.attempt !== event.attempt || candidate.agentServiceId !== run.agentServiceId || candidate.bootstrapReference !== bootstrap.id) return "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID";
	if (event.kind !== RunOutboxEventKind.RunWorkloadReleaseRequested || event.runId !== run.id || event.attempt !== run.attempt) return "RUN_WORKLOAD_RELEASE_AUTHORITY_STALE";
	if (assignment.runId !== run.id || assignment.attempt !== run.attempt || assignment.agentServiceId !== run.agentServiceId || assignment.agentRevisionId !== run.agentRevisionId || assignment.siloId !== run.siloId) return "RUN_WORKLOAD_RELEASE_AUTHORITY_STALE";
	if (!_BootstrapMatches(bootstrap, bootstrap.id, assignment) || !_ReleaseEventMatches(event, assignment, bootstrap.id)) return "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID";
	return null;
}

/** Claim and fail one persistent poisoned release so a later valid row can be selected. */
async function _TerminalizePoisonedRelease(transaction: Prisma.TransactionClient, event: OutboxEvent, run: AgentRun, assignment: WorkloadAssignment | null, bootstrap: WorkloadBootstrap | null, now: Date, failureCode: string): Promise<void>
{
	// 1. Revoke any still-pending assignment before failing this exact Assigned attempt.
	const revoked = assignment === null ? { count: 0 } : await transaction.workloadAssignment.updateMany({ where: { runId: run.id, attempt: event.attempt, state: WorkloadAssignmentState.PendingPod, podUid: null }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
	const failedRun = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: event.attempt, state: AgentRunState.Assigned }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: now } });

	// 2. Fail the poisoned release under its exact delivery generation.
	const claimedAt = new Date(Math.max(now.getTime(), (event.claimedAt?.getTime() ?? -1) + 1));
	const failed = await transaction.outboxEvent.updateMany({ where: { id: event.id, claimedAt: event.claimedAt, deliveryCount: event.deliveryCount, publishedAt: null, failedAt: null }, data: { claimedAt, deliveryCount: event.deliveryCount + 1, failedAt: claimedAt, failureCode } });
	if ((assignment !== null && revoked.count !== 1) || failedRun.count !== 1 || failed.count !== 1) throw new Error("poisoned run workload release lost its terminal failure fence");

	// 3. A committed assignment always receives exact physical cleanup authority; TTL cannot remove a suspended Job.
	if (assignment !== null)
	{
		const maximum = await transaction.outboxEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.outboxEvent.create({ data: {
			runId: run.id,
			attempt: event.attempt,
			sequence: (maximum._max.sequence ?? 0) + 1,
			kind: RunOutboxEventKind.RunWorkloadCleanupRequested,
			idempotencyKey: `${run.id}:cleanup:${event.attempt}`,
			payload: { runId: run.id, attempt: event.attempt, siloId: run.siloId, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, namespace: assignment.namespace, workloadProfile: assignment.workloadProfile, bootstrapReference: bootstrap?.id ?? "unavailable", workloadUid: assignment.workloadUid, mode: "assigned", reason: "dispatch_failure" },
			availableAt: now,
		} });
	}

	// 4. Conversation-bound runs require their contiguous canonical failure event.
	if (run.threadId !== null)
	{
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.conversationRunEvent.create({ data: { runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: "run.failed", payload: { terminalReason: "runtime_failure", failureCode }, occurredAt: now } });
	}
}

/** Extract the single model alias frozen into the snapshot's server-selected route. */
function _SnapshotModelAlias(modelRoute: unknown): string | null
{
	if (!modelRoute || typeof modelRoute !== "object" || Array.isArray(modelRoute)) return null;
	const route = modelRoute as Record<string, unknown>;
	const alias = typeof route["alias"] === "string" ? route["alias"] : typeof route["publicModelName"] === "string" ? route["publicModelName"] : "";
	return alias.trim().length > 0 && alias.length <= 128 ? alias : null;
}

/** Derive the positive US-dollar spend ceiling from the snapshot's micro-dollar cost policy. */
function _SnapshotMaxBudgetUsd(budgetPolicy: unknown): number | null
{
	if (!budgetPolicy || typeof budgetPolicy !== "object" || Array.isArray(budgetPolicy)) return null;
	const micros = (budgetPolicy as Record<string, unknown>)["maxCostUsdMicros"];
	if (typeof micros !== "number" || !Number.isSafeInteger(micros) || micros <= 0) return null;
	return micros / 1_000_000;
}

/** Derive one attempt- and delivery-unique key alias satisfying the issuer's `attempt-<hex>` grammar. */
function _AttemptKeyAlias(runId: string, attempt: number, siloId: string, deliveryCount: number): string
{
	const canonical = JSON.stringify(["opencrane-attempt-litellm-key-alias-v1", runId, attempt, siloId, deliveryCount]);
	return `attempt-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Bound the minted key lifetime to whole seconds within the issuer's 24-hour ceiling. */
function _AttemptKeyExpirySeconds(assignmentTtlMilliseconds: number): number
{
	return Math.min(Math.floor(assignmentTtlMilliseconds / 1_000), 86_400);
}

/** Validate untrusted first-Pod evidence before it reaches Prisma or SQL. */
function _RegistrationCommandIsValid(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, namespace: string): boolean
{
	return eventId.trim().length > 0 && eventId.length <= 256
		&& command.runId.trim().length > 0 && command.runId.length <= 256
		&& Number.isSafeInteger(command.attempt) && command.attempt > 0
		&& Number.isSafeInteger(command.deliveryCount) && command.deliveryCount > 0
		&& _CanonicalUtcInstantEpochMilliseconds(command.claimedAt) !== null
		&& command.siloId.trim().length > 0 && command.siloId.length <= 256
		&& command.agentServiceId.trim().length > 0 && command.agentServiceId.length <= 256
		&& command.agentRevisionId.trim().length > 0 && command.agentRevisionId.length <= 256
		&& command.namespace === namespace
		&& ___IsAgentRuntimeServiceAccountName(command.serviceAccountName)
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.workloadUid)
		&& command.workloadProfile.trim().length > 0 && command.workloadProfile.length <= 128
		&& /^bootstrap-v1_[0-9a-f]{64}$/.test(command.bootstrapReference)
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(command.podUid);
}

/** Compare first-Pod evidence against the full immutable assignment, bootstrap, and event. */
function _RegistrationMatches(assignment: WorkloadAssignment, bootstrap: WorkloadBootstrap, event: OutboxEvent, command: AgentControllerRunWorkloadRegistrationCommand): boolean
{
	return assignment.runId === command.runId
		&& assignment.attempt === command.attempt
		&& assignment.siloId === command.siloId
		&& assignment.agentServiceId === command.agentServiceId
		&& assignment.agentRevisionId === command.agentRevisionId
		&& assignment.namespace === command.namespace
		&& assignment.serviceAccountName === command.serviceAccountName
		&& assignment.workloadKind === WorkloadKind.Job
		&& assignment.workloadUid === command.workloadUid
		&& assignment.workloadProfile === command.workloadProfile
		&& _BootstrapMatches(bootstrap, command.bootstrapReference, assignment)
		&& _ReleaseEventMatches(event, assignment, command.bootstrapReference);
}
