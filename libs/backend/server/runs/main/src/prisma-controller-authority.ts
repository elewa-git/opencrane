import { createHash, randomUUID } from "node:crypto";

import { AgentRevisionState, AgentRunState, AgentServiceState, Prisma, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";

import { __ResolveControllerRuntimeProfile } from "./controller-authority.js";
import type { ControllerAuthorityRepository, ControllerDesiredJob, ControllerJobObservation, ControllerPodObservation } from "./controller-authority.types.js";

/** Maximum number of controller deliveries attempted for one durable run-attempt event. */
const _MAX_CLAIM_DELIVERIES = 5;

/** Lease period after which an unacknowledged desired job can be reclaimed safely. */
const _CLAIM_LEASE_MS = 30_000;

/** Audience used by runtime Pods when exchanging their projected workload token. */
const _RUNTIME_AUDIENCE = "opencrane";

/** Prisma-backed controller authority that derives all desired workload state from canonical rows. */
export class PrismaControllerAuthorityRepository implements ControllerAuthorityRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Server-owned runtime coordinates indexed by immutable AgentService profile key. */
	private readonly runtimeProfiles: ReadonlyMap<string, { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number }>;

	/** Creates the controller persistence adapter over canonical database and deployment policy. */
	constructor(prisma: PrismaClient, runtimeProfiles: ReadonlyMap<string, { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number }>)
	{
		this.prisma = prisma;
		this.runtimeProfiles = runtimeProfiles;
	}

	/** Claims at most one reclaimable durable run-attempt request and derives its desired Job. */
	async claimDesiredJob(nowEpochMs: number): Promise<ControllerDesiredJob | null>
	{
		const now = new Date(nowEpochMs);
		const leaseExpiry = new Date(nowEpochMs - _CLAIM_LEASE_MS);
		return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) =>
		{
			// 1. Read a candidate without locking it; all durable locks below use service, run, then event.
			const candidate = await transaction.outboxEvent.findFirst({
				where: { kind: RunOutboxEventKind.RunAttemptRequested, publishedAt: null, failedAt: null, availableAt: { lte: now }, OR: [{ deliveryCount: { gte: _MAX_CLAIM_DELIVERIES }, claimedAt: null }, { deliveryCount: { gte: _MAX_CLAIM_DELIVERIES }, claimedAt: { lt: leaseExpiry } }, { deliveryCount: { lt: _MAX_CLAIM_DELIVERIES }, claimedAt: null }, { deliveryCount: { lt: _MAX_CLAIM_DELIVERIES }, claimedAt: { lt: leaseExpiry } }] },
				orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
			});
			if (candidate === null) return null;

			// 2. Lock canonical service and run before the selected outbox event to avoid lock inversions.
			const initialRun = await transaction.agentRun.findUnique({ where: { id: candidate.runId } });
			if (initialRun === null)
			{
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${candidate.id} FOR UPDATE`);
				const event = await transaction.outboxEvent.findUnique({ where: { id: candidate.id } });
				if (event !== null && event.publishedAt === null && event.failedAt === null) await _failOutboxEvent(transaction, event.id, now, "stale_or_invalid_run_attempt");
				return null;
			}
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${initialRun.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${candidate.runId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "id" = ${candidate.id} FOR UPDATE`);
			const event = await transaction.outboxEvent.findUnique({ where: { id: candidate.id } });
			const run = await transaction.agentRun.findUnique({ where: { id: candidate.runId } });
			if (event === null || event.publishedAt !== null || event.failedAt !== null || event.availableAt > now) return null;
			if (event.deliveryCount >= _MAX_CLAIM_DELIVERIES)
			{
				if (event.claimedAt === null || event.claimedAt >= leaseExpiry) return null;
				if (run !== null && run.attempt === event.attempt && (run.state === AgentRunState.Accepted || run.state === AgentRunState.Queued))
				{
					await transaction.agentRun.update({ where: { id: run.id }, data: { state: AgentRunState.Failed, finishedAt: now, terminalReason: "RuntimeFailure" } });
				}
				await _failOutboxEvent(transaction, event.id, now, "controller_delivery_exhausted");
				return null;
			}
			if (event.claimedAt !== null && event.claimedAt >= leaseExpiry) return null;
			await transaction.outboxEvent.update({ where: { id: event.id }, data: { claimedAt: now, deliveryCount: { increment: 1 } } });

			// 3. Derive desired state only after the current canonical rows are locked and revalidated.
			if (run === null || run.agentServiceId !== initialRun.agentServiceId || !_requestedPayloadMatches(event.payload, event.runId, event.attempt) || run.attempt !== event.attempt || (run.state !== AgentRunState.Accepted && run.state !== AgentRunState.Queued))
			{
				await _failOutboxEvent(transaction, event.id, now, "stale_or_invalid_run_attempt");
				return null;
			}
			const service = await transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_revisions" WHERE "agent_service_id" = ${run.agentServiceId} AND "id" = ${run.agentRevisionId} FOR UPDATE`);
			const revision = await transaction.agentRevision.findUnique({ where: { agentServiceId_id: { agentServiceId: run.agentServiceId, id: run.agentRevisionId } } });
			const profile = service === null ? null : __ResolveControllerRuntimeProfile(service.workloadProfile, this.runtimeProfiles);
			if (service === null || revision === null || service.siloId !== run.siloId || service.state !== AgentServiceState.Active || service.activeRevisionId !== run.agentRevisionId || revision.state !== AgentRevisionState.Published || profile === null)
			{
				await _failOutboxEvent(transaction, event.id, now, "runtime_authority_unavailable");
				return null;
			}
			const claimPayload = _bindRuntimeProfile(event.payload, service.workloadProfile);
			if (claimPayload === null)
			{
				await _failOutboxEvent(transaction, event.id, now, "runtime_profile_changed");
				return null;
			}
			await transaction.outboxEvent.update({ where: { id: event.id }, data: { payload: claimPayload } });

			// 4. Persist Queued before returning so a later acknowledgement can atomically create the assignment.
			if (run.state === AgentRunState.Accepted)
			{
				await transaction.agentRun.update({ where: { id: run.id }, data: { state: AgentRunState.Queued } });
			}
			return {
				runId: run.id,
				attempt: run.attempt,
				agentServiceId: run.agentServiceId,
				agentRevisionId: run.agentRevisionId,
				siloId: run.siloId,
				subjectId: run.executionSubjectId,
				namespace: profile.namespace,
				serviceAccountName: profile.serviceAccountName,
				image: profile.image,
			};
		});
	}

	/** Records a controller Job acknowledgement without accepting any controller-selected authority fields. */
	async recordJob(observation: ControllerJobObservation, nowEpochMs: number): Promise<{ readonly bootstrapReady: boolean }>
	{
		const coordinates = _jobCoordinates(observation);
		if (coordinates.workloadName !== _kubernetesJobName(coordinates.runId, coordinates.attempt)) throw new Error("unexpected deterministic Job name");
		const now = new Date(nowEpochMs);
		return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) =>
		{
			// 1. Match the shared service-then-run lock order before the event lock.
			const initialRun = await transaction.agentRun.findUnique({ where: { id: coordinates.runId } });
			if (initialRun === null) throw new Error("run attempt is not awaiting assignment");
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_services" WHERE "id" = ${initialRun.agentServiceId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${coordinates.runId} FOR UPDATE`);
			const run = await transaction.agentRun.findUnique({ where: { id: coordinates.runId } });
			if (run === null || run.agentServiceId !== initialRun.agentServiceId || run.attempt !== coordinates.attempt || (run.state !== AgentRunState.Queued && run.state !== AgentRunState.Assigned))
			{
				throw new Error("run attempt is not awaiting assignment");
			}

			// 2. Reconfirm the service profile before storing the proof-bound workload identity.
			const service = await transaction.agentService.findUnique({ where: { id: run.agentServiceId } });
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_revisions" WHERE "agent_service_id" = ${run.agentServiceId} AND "id" = ${run.agentRevisionId} FOR UPDATE`);
			const revision = await transaction.agentRevision.findUnique({ where: { agentServiceId_id: { agentServiceId: run.agentServiceId, id: run.agentRevisionId } } });
			const profile = service === null ? null : __ResolveControllerRuntimeProfile(service.workloadProfile, this.runtimeProfiles);
			if (service === null || revision === null || service.siloId !== run.siloId || service.state !== AgentServiceState.Active || service.activeRevisionId !== run.agentRevisionId || revision.state !== AgentRevisionState.Published || profile === null)
			{
				throw new Error("runtime authority is unavailable");
			}
			const existing = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: run.id, attempt: run.attempt } } });
			if (existing !== null)
			{
				if (existing.workloadKind !== WorkloadKind.Job || existing.workloadUid !== coordinates.workloadUid) throw new Error("conflicting workload acknowledgement");
				return { bootstrapReady: false };
			}
			if (run.state !== AgentRunState.Queued) throw new Error("assigned run has no workload assignment");
			const event = await _lockAttemptEvent(transaction, coordinates.runId, coordinates.attempt);
			if (event === null) throw new Error("run attempt is not awaiting assignment");
			if (event.claimedAt === null || event.claimedAt.getTime() < nowEpochMs - _CLAIM_LEASE_MS) throw new Error("controller acknowledgement lease expired");
			if (_claimedRuntimeProfile(event.payload) !== service.workloadProfile) throw new Error("runtime profile changed after desired Job issuance");

			// 3. Insert assignment and opaque bootstrap before marking the outbox delivered or changing run lifecycle.
			const expiresAt = new Date(nowEpochMs + profile.assignmentTtlMs);
			await transaction.workloadAssignment.create({
				data: { runId: run.id, attempt: run.attempt, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, siloId: run.siloId, subjectId: run.executionSubjectId, audience: _RUNTIME_AUDIENCE, serviceAccountName: profile.serviceAccountName, namespace: profile.namespace, workloadKind: WorkloadKind.Job, workloadUid: coordinates.workloadUid, expiresAt },
			});
			await transaction.workloadBootstrap.create({
				data: { runId: run.id, attempt: run.attempt, agentServiceId: run.agentServiceId, agentRevisionId: run.agentRevisionId, siloId: run.siloId, subjectId: run.executionSubjectId, audience: _RUNTIME_AUDIENCE, serviceAccountName: profile.serviceAccountName, namespace: profile.namespace, workloadKind: WorkloadKind.Job, workloadUid: coordinates.workloadUid, claimDigest: _opaqueBootstrapDigest(), expiresAt },
			});
			await transaction.agentRun.update({ where: { id: run.id }, data: { state: AgentRunState.Assigned } });
			await transaction.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: now } });

			// 4. Keep the Job suspended: no bootstrap delivery mechanism exists in this slice yet.
			return { bootstrapReady: false };
		});
	}

	/** Records the first Pod UID for an exact previously assigned Job. */
	async recordPod(observation: ControllerPodObservation, nowEpochMs: number): Promise<void>
	{
		const coordinates = _podCoordinates(observation);
		if (coordinates.workloadName !== _kubernetesJobName(coordinates.runId, coordinates.attempt)) throw new Error("unexpected deterministic Job name");
		return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) =>
		{
			// 1. Lock the run before the assignment, matching runtime bootstrap consumption.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${coordinates.runId} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${coordinates.runId} AND "attempt" = ${coordinates.attempt} FOR UPDATE`);
			const assignment = await transaction.workloadAssignment.findUnique({ where: { runId_attempt: { runId: coordinates.runId, attempt: coordinates.attempt } } });
			const run = await transaction.agentRun.findUnique({ where: { id: coordinates.runId } });
			if (assignment === null || run === null || run.attempt !== coordinates.attempt || (run.state !== AgentRunState.Assigned && run.state !== AgentRunState.Running) || assignment.workloadKind !== WorkloadKind.Job || assignment.workloadUid !== coordinates.workloadUid)
			{
				throw new Error("pod does not belong to the current workload assignment");
			}

			// 2. Preserve the first immutable Pod UID; repeats are idempotent and competing Pods fail closed.
			if (assignment.podUid === null)
			{
				await transaction.workloadAssignment.update({ where: { runId_attempt: { runId: coordinates.runId, attempt: coordinates.attempt } }, data: { podUid: coordinates.podUid, state: WorkloadAssignmentState.Registered, registeredAt: new Date(nowEpochMs) } });
				return;
			}
			if (assignment.podUid !== coordinates.podUid) throw new Error("conflicting pod acknowledgement");
		});
	}

	/** Marks one unsafe desired Job failed, including an unstarted assigned attempt, transactionally. */
	async rejectDesiredJob(runId: string, attempt: number, reason: string, nowEpochMs: number): Promise<void>
	{
		const now = new Date(nowEpochMs);
		return this.prisma.$transaction(async (transaction: Prisma.TransactionClient) =>
		{
			// 1. Lock the run before the event so rejection cannot invert a claim or acknowledgement.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${runId} FOR UPDATE`);
			const run = await transaction.agentRun.findUnique({ where: { id: runId } });
			const event = await _lockAttemptEvent(transaction, runId, attempt, true);
			if (event === null || run === null || run.attempt !== attempt || (run.state !== AgentRunState.Queued && run.state !== AgentRunState.Assigned)) throw new Error("run attempt cannot be rejected");

			// 2. Revoke an unstarted assignment before failing the run, so a deleted unsafe Job cannot wedge it.
			if (run.state === AgentRunState.Assigned)
			{
				await transaction.workloadAssignment.updateMany({ where: { runId, attempt, state: WorkloadAssignmentState.PendingPod }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: now } });
			}
			// 3. Fail both durable records together so the bad event cannot block later work or look pending.
			await transaction.agentRun.update({ where: { id: run.id }, data: { state: AgentRunState.Failed, finishedAt: now, terminalReason: "RuntimeFailure" } });
			await _failOutboxEvent(transaction, event.id, now, _failureCode(reason));
		});
	}
}

/** Locks the one unpublished attempt-request event for a run attempt. */
async function _lockAttemptEvent(transaction: Prisma.TransactionClient, runId: string, attempt: number, includePublished = false): Promise<{ readonly id: string; readonly claimedAt: Date | null; readonly payload: Prisma.JsonValue } | null>
{
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "run_outbox_events" WHERE "run_id" = ${runId} AND "attempt" = ${attempt} AND "kind" = CAST(${"run.attempt_requested"} AS "RunOutboxEventKind") AND "failed_at" IS NULL ${includePublished ? Prisma.empty : Prisma.sql`AND "published_at" IS NULL`} FOR UPDATE`);
	const events = await transaction.outboxEvent.findMany({ where: { runId, attempt, kind: RunOutboxEventKind.RunAttemptRequested, failedAt: null, ...(includePublished ? {} : { publishedAt: null }) }, select: { id: true, claimedAt: true, payload: true }, take: 2 });
	return events.length === 1 ? events[0] ?? null : null;
}

/** Marks a locked outbox record terminally failed without discarding its audit trail. */
async function _failOutboxEvent(transaction: Prisma.TransactionClient, eventId: string, failedAt: Date, failureCode: string): Promise<void>
{
	await transaction.outboxEvent.update({ where: { id: eventId }, data: { failedAt, failureCode } });
}

/** Returns true only when an outbox payload repeats the row's exact durable attempt coordinates. */
function _requestedPayloadMatches(payload: Prisma.JsonValue, runId: string, attempt: number): boolean
{
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
	const value = payload as Record<string, unknown>;
	return value.runId === runId && value.attempt === attempt;
}

/** Binds one server-selected runtime profile to a reclaimable outbox request. */
function _bindRuntimeProfile(payload: Prisma.JsonValue, runtimeProfile: string): Prisma.InputJsonValue | null
{
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const value = payload as Record<string, unknown>;
	if (typeof value.controllerRuntimeProfile === "string" && value.controllerRuntimeProfile !== runtimeProfile) return null;
	return { ...value, controllerRuntimeProfile: runtimeProfile } as Prisma.InputJsonValue;
}

/** Reads the one immutable server-selected runtime profile from an outbox request. */
function _claimedRuntimeProfile(payload: Prisma.JsonValue): string | null
{
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const value = payload as Record<string, unknown>;
	return typeof value.controllerRuntimeProfile === "string" ? value.controllerRuntimeProfile : null;
}

/** Narrows the evolving public acknowledgement contract to its non-authoritative coordinates. */
function _jobCoordinates(observation: ControllerJobObservation): { readonly runId: string; readonly attempt: number; readonly workloadName: string; readonly workloadUid: string }
{
	return observation;
}

/** Narrows the evolving public Pod acknowledgement contract to its non-authoritative coordinates. */
function _podCoordinates(observation: ControllerPodObservation): { readonly runId: string; readonly attempt: number; readonly workloadName: string; readonly workloadUid: string; readonly podUid: string }
{
	return observation;
}

/** Builds the exact deterministic Job name accepted from the controller acknowledgement protocol. */
function _kubernetesJobName(runId: string, attempt: number): string
{
	const prefix = "agent-run-";
	const digest = createHash("sha256").update(`${runId}:${attempt}`).digest("hex").slice(0, 16);
	const suffix = `-${digest}-a${attempt}`;
	return `${prefix}${runId.slice(0, 63 - prefix.length - suffix.length)}${suffix}`;
}

/** Produces a server-only opaque bootstrap digest; the secret material is never returned to the controller. */
function _opaqueBootstrapDigest(): string
{
	return `sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`;
}

/** Converts an untrusted controller reason into a bounded durable diagnostic code. */
function _failureCode(reason: string): string
{
	const normalized = reason.trim().replace(/[^a-z0-9_.-]/giu, "_");
	return normalized.slice(0, 120) || "controller_rejected_desired_job";
}
