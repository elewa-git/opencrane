import { createHash } from "node:crypto";

import { AgentRunState as PrismaAgentRunState, Prisma, RuntimeCommandKind, WorkloadAssignmentState, type PrismaClient, type WorkloadKind } from "@prisma/client";

import { AGENT_RUNTIME_PROTOCOL_V1, type RunInputSnapshot, type RunInputSnapshotIdentity, type RuntimeAssignment, type RuntimeCandidate, type RuntimeCommand, type RuntimeCommandEnvelope, type RuntimeStreamOpen } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

import { __AdmitRuntimeCandidate, __AdmitRuntimeCommand } from "./runtime-protocol-authority.js";
import type { RuntimeAdmissionRunState, RuntimeAttemptAuthority, RuntimeProtocolClock } from "./runtime-protocol-authority.types.js";
import type { RuntimeCandidateDispatchResult, RuntimeDispatchAuthorityConfig, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types.js";

/** Immutable durable facts loaded and locked for one connected runtime Pod. */
interface RuntimeDispatchContext
{
	/** Run authorised for the connected Pod. */
	readonly runId: string;
	/** Positive run attempt authorised for the exact workload assignment. */
	readonly attempt: number;
	/** AgentService executed by the workload. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision loaded by the runtime. */
	readonly agentRevisionId: string;
	/** Silo in which the assignment is valid. */
	readonly siloId: string;
	/** Subject whose authority admitted the workload assignment. */
	readonly subjectId: string;
	/** Projected-token audience fixed for this workload. */
	readonly audience: string;
	/** Dedicated Kubernetes namespace containing the runtime workload. */
	readonly namespace: string;
	/** Kubernetes workload kind bound to the assignment. */
	readonly workloadKind: WorkloadKind;
	/** Immutable Kubernetes workload UID bound to the assignment. */
	readonly workloadUid: string;
	/** Owning-run lifecycle state that gates every command and candidate. */
	readonly runState: RuntimeAdmissionRunState;
	/** Canonical digest of the immutable assignment claims carried on every command. */
	readonly assignmentDigest: string;
	/** Immutable input-snapshot digest fixed for the attempt. */
	readonly inputSnapshotDigest: string;
	/** Complete immutable input snapshot carried by the start-attempt command. */
	readonly snapshot: RunInputSnapshot;
	/** Approved persona revision compiled for the run, when present. */
	readonly personaRevisionId: string | null;
	/** Subject user whose membership and grants authorised the run. */
	readonly subjectUserId: string;
	/** Highest verified fleet-membership revision used for authorisation. */
	readonly fleetMembershipRevision: number;
	/** Digest of the effective proof-bound capability set for the attempt. */
	readonly capabilitySetDigest: string;
	/** Expected Kubernetes ServiceAccount name for the runtime workload. */
	readonly serviceAccountName: string;
	/** Registered runtime Pod UID bound to the assignment. */
	readonly podUid: string;
	/** Hard assignment lease expiry in epoch milliseconds. */
	readonly leaseExpiresAtEpochMs: number;
	/** Canonical assignment issuance instant reused on every frame. */
	readonly assignmentIssuedAt: string;
	/** Canonical assignment expiry instant reused on every frame. */
	readonly assignmentExpiresAt: string;
}

/** Minimal dispatched-command row required to rebuild or account for a minted frame. */
interface DispatchedCommandRow
{
	/** Opaque idempotency key assigned by the control plane. */
	readonly commandId: string;
	/** Strictly monotonic command sequence for the attempt. */
	readonly sequence: number;
	/** Command kind that was durably minted. */
	readonly kind: RuntimeCommandKind;
	/** Server-owned lease fence carried by the frame. */
	readonly fence: number;
	/** Canonical issuance instant of the minted frame. */
	readonly issuedAt: Date;
	/** Canonical hard expiry of the minted frame. */
	readonly expiresAt: Date;
}

/**
 * Prisma-backed durable command dispatch and candidate admission for connected runtime Pods.
 *
 * The adapter loads and locks the live WorkloadAssignment, its AgentRun, and the immutable
 * RunInputSnapshot for the reviewed Pod, then delegates every allow-or-deny decision to the pure
 * `__AdmitRuntimeCommand` / `__AdmitRuntimeCandidate` authority. It only mints a frame the pure
 * authority accepts, and advances the monotonic command sequence and accepted candidate ids inside
 * the same transaction so a wire-format or transport bug can neither reorder nor duplicate work.
 */
export class PrismaRuntimeDispatchAuthority
{
	/** Canonical OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Fixed namespace and command-lifetime policy. */
	private readonly config: RuntimeDispatchAuthorityConfig;
	/** Trusted server clock, never a runtime-supplied time. */
	private readonly clock: RuntimeProtocolClock;

	/** Creates a dispatch adapter over canonical Postgres with a bounded command lifetime. */
	constructor(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, clock?: RuntimeProtocolClock)
	{
		if (!_configIsValid(config)) throw new Error("runtime dispatch authority requires a bounded namespace and command lifetime");
		this.prisma = prisma;
		this.config = config;
		this.clock = clock ?? { nowEpochMs(): number { return Date.now(); } };
	}

	/** Returns the next server-issued command after the supplied sequence, or null while idle. */
	async __NextCommand(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
	{
		if (identity.namespace !== this.config.namespace || open.podUid !== identity.podUid) return null;
		const prisma = this.prisma;
		const config = this.config;
		const clock = this.clock;
		return ___DoWithTrace("runtime_dispatch.command.next", { namespace: identity.namespace }, async function _traceNext(): Promise<RuntimeCommandEnvelope | null>
		{
			return _nextCommand(prisma, config, clock, identity, open, afterSequence);
		});
	}

	/** Admits a runtime candidate through the pure authority and durably records acceptance. */
	async __AdmitCandidate(identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateDispatchResult>
	{
		if (identity.namespace !== this.config.namespace) return { accepted: false, reason: "namespace_mismatch" };
		const prisma = this.prisma;
		const clock = this.clock;
		return ___DoWithTrace("runtime_dispatch.candidate.admit", { namespace: identity.namespace }, async function _traceAdmit(): Promise<RuntimeCandidateDispatchResult>
		{
			return _admitCandidate(prisma, clock, identity, candidate);
		});
	}

	/** Releases the runtime-instance binding when its stream is lost so a clean reconnect can rebind. */
	async __ReleaseStream(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
	{
		if (identity.namespace !== this.config.namespace || open.podUid !== identity.podUid) return;
		const prisma = this.prisma;
		await ___DoWithTrace("runtime_dispatch.stream.release", { namespace: identity.namespace }, async function _traceRelease(): Promise<void>
		{
			await _releaseStream(prisma, identity, open);
		});
	}
}

/** Validate fixed dispatch policy before any database transaction begins. */
function _configIsValid(config: RuntimeDispatchAuthorityConfig): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(config.namespace)
		&& config.namespace.length <= 63
		&& Number.isSafeInteger(config.commandTtlMilliseconds)
		&& config.commandTtlMilliseconds >= 1_000
		&& config.commandTtlMilliseconds <= 300_000;
}

/** Mint or redeliver one command for the connected runtime inside a single locked transaction. */
async function _nextCommand(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
{
	if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return null;
	return prisma.$transaction(async function _dispatch(transaction: Prisma.TransactionClient): Promise<RuntimeCommandEnvelope | null>
	{
		// 1. Load and lock the live assignment, run, and snapshot before any authority decision.
		const context = await _loadContext(transaction, identity);
		if (context === null) return null;
		if (!await _bootstrapProofIsLive(transaction, context, clock.nowEpochMs())) return null;

		// 2. Bind the stream to the connecting runtime instance only after one-use bootstrap proof exists.
		const runtimeInstanceId = await _bindRuntimeInstance(transaction, context, open.runtimeInstanceId);
		if (runtimeInstanceId === null) return null;
		const stream = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
		if (stream === null) return null;
		const commands = await transaction.runtimeDispatchedCommand.findMany({ where: { runId: context.runId, attempt: context.attempt }, orderBy: { sequence: "asc" } });
		const authority = _buildAuthority(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);

		// 3. Redeliver a stored command the transport has not yet re-sent on this connection.
		const targetSequence = afterSequence + 1;
		const stored = commands.find(function _atTarget(row) { return row.sequence === targetSequence; });
		if (stored)
		{
			const envelope = _rebuildEnvelope(context, runtimeInstanceId, stored);
			const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
			return admission.outcome === "idempotent" ? envelope : null;
		}
		if (targetSequence !== stream.nextCommandSequence) return null;

		// 4. Decide whether a new lifecycle command is due, mint it, and admit it before persisting.
		const kind = _decideKind(context.runState, commands);
		if (kind === null) return null;
		const nowEpochMs = clock.nowEpochMs();
		const envelope = _mintEnvelope(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, kind, nowEpochMs, config.commandTtlMilliseconds);
		if (envelope === null) return null;
		const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
		if (admission.outcome !== "accepted") return null;

		// 5. Persist the accepted command and advance the monotonic sequence under the held lock.
		await transaction.runtimeDispatchedCommand.create({ data: { runId: context.runId, attempt: context.attempt, sequence: envelope.sequence, commandId: envelope.commandId, kind, fence: envelope.fence, issuedAt: new Date(envelope.issuedAt), expiresAt: new Date(envelope.expiresAt) } });
		const advanced = await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, nextCommandSequence: stream.nextCommandSequence }, data: { nextCommandSequence: admission.nextCommandSequence } });
		if (advanced.count !== 1) throw new Error("runtime dispatch lost its command sequence fence");
		return envelope;
	});
}

/** Admit one runtime candidate and durably record its id when the pure authority accepts it. */
async function _admitCandidate(prisma: PrismaClient, clock: RuntimeProtocolClock, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateDispatchResult>
{
	return prisma.$transaction(async function _admit(transaction: Prisma.TransactionClient): Promise<RuntimeCandidateDispatchResult>
	{
		// 1. Load and lock the live assignment, run, snapshot, and consumed bootstrap proof for the Pod.
		const context = await _loadContext(transaction, identity);
		if (context === null) return { accepted: false, reason: "unknown_workload" };
		if (!await _bootstrapProofIsLive(transaction, context, clock.nowEpochMs())) return { accepted: false, reason: "unknown_workload" };
		const stream = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
		if (stream === null || stream.runtimeInstanceId === null) return { accepted: false, reason: "no_active_stream" };
		const commands = await transaction.runtimeDispatchedCommand.findMany({ where: { runId: context.runId, attempt: context.attempt }, orderBy: { sequence: "asc" } });
		const authority = _buildAuthority(context, stream.runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);

		// 2. Delegate the allow-or-deny decision to the pure candidate authority.
		const admission = __AdmitRuntimeCandidate({ authority, candidate, clock });
		if (admission.outcome === "idempotent") return { accepted: true };
		if (admission.outcome === "denied") return { accepted: false, reason: admission.reason };

		// 3. Append the accepted candidate id monotonically under the held stream lock.
		const appended = await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, nextCommandSequence: stream.nextCommandSequence }, data: { acceptedCandidateIds: { push: candidate.candidateId } } });
		if (appended.count !== 1) throw new Error("runtime dispatch lost its candidate acceptance fence");
		return { accepted: true };
	});
}

/** Unbind the runtime instance from its stream if the closing connection still owns it. */
async function _releaseStream(prisma: PrismaClient, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
{
	await prisma.$transaction(async function _release(transaction: Prisma.TransactionClient): Promise<void>
	{
		const context = await _loadContext(transaction, identity);
		if (context === null) return;
		await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, runtimeInstanceId: open.runtimeInstanceId }, data: { runtimeInstanceId: null } });
	});
}

/** Load and lock the assignment, run, and snapshot for the reviewed namespace and Pod UID. */
async function _loadContext(transaction: Prisma.TransactionClient, identity: RuntimeStreamWorkloadIdentity): Promise<RuntimeDispatchContext | null>
{
	// 1. Establish the assignment lock by its unique namespace/Pod key before reading dependents.
	await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "namespace" = ${identity.namespace} AND "pod_uid" = ${identity.podUid} FOR UPDATE`);
	const assignment = await transaction.workloadAssignment.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
	if (assignment === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered || assignment.serviceAccountName !== identity.serviceAccountName) return null;

	// 2. Reload the owning run and its immutable snapshot under the assignment lock.
	const run = await transaction.agentRun.findUnique({ where: { id: assignment.runId } });
	if (run === null || run.attempt !== assignment.attempt || run.agentServiceId !== assignment.agentServiceId || run.agentRevisionId !== assignment.agentRevisionId || run.siloId !== assignment.siloId) return null;
	const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: run.id, digest: run.inputSnapshotDigest } } });
	if (snapshot === null) return null;
	const snapshotIdentity = _snapshotIdentity(snapshot.identitySnapshot);
	if (snapshotIdentity === null) return null;

	// 3. Compute the canonical assignment digest and return the immutable dispatch context.
	const assignmentDigest = _computeAssignmentDigest({ runId: assignment.runId, attempt: assignment.attempt, agentServiceId: assignment.agentServiceId, agentRevisionId: assignment.agentRevisionId, siloId: assignment.siloId, subjectId: assignment.subjectId, serviceAccountName: assignment.serviceAccountName, podUid: assignment.podUid, expiresAt: assignment.expiresAt, createdAt: assignment.createdAt });
	return {
		runId: assignment.runId,
		attempt: assignment.attempt,
		agentServiceId: assignment.agentServiceId,
		agentRevisionId: assignment.agentRevisionId,
		siloId: assignment.siloId,
		subjectId: assignment.subjectId,
		audience: assignment.audience,
		namespace: assignment.namespace,
		workloadKind: assignment.workloadKind,
		workloadUid: assignment.workloadUid,
		runState: _toAdmissionRunState(run.state),
		assignmentDigest,
		inputSnapshotDigest: run.inputSnapshotDigest,
		snapshot: _buildSnapshotFrame(snapshot),
		personaRevisionId: snapshot.personaRevisionId,
		subjectUserId: snapshotIdentity.subjectUserId,
		fleetMembershipRevision: snapshotIdentity.fleetMembershipRevision,
		capabilitySetDigest: snapshot.capabilitySetDigest,
		serviceAccountName: assignment.serviceAccountName,
		podUid: assignment.podUid,
		leaseExpiresAtEpochMs: assignment.expiresAt.getTime(),
		assignmentIssuedAt: assignment.createdAt.toISOString(),
		assignmentExpiresAt: assignment.expiresAt.toISOString(),
	};
}

/** Require the exact consumed bootstrap and its live, unrevoked proof key before serving runtime work. */
async function _bootstrapProofIsLive(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, nowEpochMs: number): Promise<boolean>
{
	// 1. Require one consumed bootstrap whose immutable coordinates still match the locked assignment.
	const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
	if (bootstrap === null
		|| bootstrap.agentServiceId !== context.agentServiceId
		|| bootstrap.agentRevisionId !== context.agentRevisionId
		|| bootstrap.siloId !== context.siloId
		|| bootstrap.subjectId !== context.subjectId
		|| bootstrap.audience !== context.audience
		|| bootstrap.serviceAccountName !== context.serviceAccountName
		|| bootstrap.namespace !== context.namespace
		|| bootstrap.workloadKind !== context.workloadKind
		|| bootstrap.workloadUid !== context.workloadUid
		|| bootstrap.consumedAt === null
		|| bootstrap.consumedByPodUid !== context.podUid
		|| bootstrap.receiptId === null
		|| bootstrap.expiresAt.getTime() <= nowEpochMs) return false;

	// 2. Require the proof key created by that exchange to remain bound to this exact Pod and lease.
	const proofKey = await transaction.runProofKey.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
	return proofKey !== null
		&& proofKey.bootstrapId === bootstrap.id
		&& proofKey.workloadKind === context.workloadKind
		&& proofKey.workloadUid === context.workloadUid
		&& proofKey.podUid === context.podUid
		&& proofKey.revokedAt === null
		&& proofKey.expiresAt.getTime() > nowEpochMs;
}

/** Lazily create the stream row and bind it to the connecting instance, or reject a stale instance. */
async function _bindRuntimeInstance(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, runtimeInstanceId: string): Promise<string | null>
{
	// 1. Lock the stream row if it already exists so binding and sequence advance are serialised.
	await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "runtime_command_streams" WHERE "run_id" = ${context.runId} AND "attempt" = ${context.attempt} FOR UPDATE`);
	const existing = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
	if (existing === null)
	{
		await transaction.runtimeCommandStream.create({ data: { runId: context.runId, attempt: context.attempt, runtimeInstanceId } });
		return runtimeInstanceId;
	}

	// 2. Bind a previously released stream, keep the same instance, and reject any other instance.
	if (existing.runtimeInstanceId === null)
	{
		await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, runtimeInstanceId: null }, data: { runtimeInstanceId } });
		return runtimeInstanceId;
	}
	return existing.runtimeInstanceId === runtimeInstanceId ? runtimeInstanceId : null;
}

/** Build the immutable attempt authority the pure decision boundary consumes. */
function _buildAuthority(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, nextCommandSequence: number, commands: readonly DispatchedCommandRow[], acceptedCandidateIds: readonly string[]): RuntimeAttemptAuthority
{
	return {
		runId: context.runId,
		attempt: context.attempt,
		fence,
		assignmentDigest: context.assignmentDigest,
		inputSnapshotDigest: context.inputSnapshotDigest,
		runtimeInstanceId,
		nextCommandSequence,
		acceptedCommandIds: commands.map(function _id(row) { return row.commandId; }),
		acceptedCandidateIds: [...acceptedCandidateIds],
		leaseExpiresAtEpochMs: context.leaseExpiresAtEpochMs,
		runState: context.runState,
	};
}

/** Build the immutable runtime assignment frame carried by every command. */
function _buildAssignmentFrame(context: RuntimeDispatchContext): RuntimeAssignment
{
	return {
		runId: context.runId,
		attempt: context.attempt,
		agentServiceId: context.agentServiceId,
		agentRevisionId: context.agentRevisionId,
		personaRevisionId: context.personaRevisionId ?? undefined,
		siloId: context.siloId,
		subjectUserId: context.subjectUserId,
		fleetMembershipRevision: context.fleetMembershipRevision,
		capabilitySetDigest: context.capabilitySetDigest,
		serviceAccountName: context.serviceAccountName,
		podUid: context.podUid,
		assignmentDigest: context.assignmentDigest,
		issuedAt: context.assignmentIssuedAt,
		expiresAt: context.assignmentExpiresAt,
	};
}

/** Rebuild a stored command's exact envelope for idempotent redelivery on reconnect. */
function _rebuildEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, row: DispatchedCommandRow): RuntimeCommandEnvelope
{
	const command = _commandBody(context, row.kind);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: row.commandId, sequence: row.sequence, fence: row.fence, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/** Mint a fresh command envelope bounded by the assignment lease, or null when it cannot be valid. */
function _mintEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, sequence: number, kind: RuntimeCommandKind, nowEpochMs: number, commandTtlMilliseconds: number): RuntimeCommandEnvelope | null
{
	// 1. Bound the command lifetime by the assignment lease so a frame never outlives its authority.
	const expiresAtEpochMs = Math.min(nowEpochMs + commandTtlMilliseconds, context.leaseExpiresAtEpochMs);
	if (nowEpochMs >= expiresAtEpochMs) return null;

	// 2. Assemble the canonical frame; the pure authority still fences, orders, and validates it.
	const command = _commandBody(context, kind);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: _commandId(context, sequence), sequence, fence, issuedAt: new Date(nowEpochMs).toISOString(), expiresAt: new Date(expiresAtEpochMs).toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/**
 * Build the kind-specific command body carried by the envelope.
 * Only `start_attempt` is dispatched in this slice; resume and cancel bodies belong to later slices.
 */
function _commandBody(context: RuntimeDispatchContext, kind: RuntimeCommandKind): RuntimeCommand
{
	if (kind !== RuntimeCommandKind.StartAttempt) throw new Error("runtime dispatch mints only start_attempt in this slice");
	return { kind: "start_attempt", payload: { snapshot: context.snapshot } };
}

/** Map the durable snapshot row into the immutable wire snapshot the runtime receives. */
function _buildSnapshotFrame(row: { runId: string; siloId: string; agentServiceId: string; agentRevisionId: string; snapshotVersion: number; threadId: string | null; messageIds: string[]; personaRevisionId: string | null; preferenceFactIds: string[]; artifactRevisionIds: string[]; skillRevisionIds: string[]; memoryFacts: Prisma.JsonValue; memoryQueryPolicy: Prisma.JsonValue; toolGrantIds: string[]; modelRoute: Prisma.JsonValue; budgetPolicy: Prisma.JsonValue; identitySnapshot: Prisma.JsonValue; capabilitySetDigest: string; effectiveContractDigest: string; promptCompilerVersion: string; digest: string; compiledAt: Date }): RunInputSnapshot
{
	return {
		runId: row.runId,
		siloId: row.siloId,
		agentServiceId: row.agentServiceId,
		agentRevisionId: row.agentRevisionId,
		snapshotVersion: row.snapshotVersion,
		threadId: row.threadId,
		messageIds: row.messageIds,
		personaRevisionId: row.personaRevisionId,
		preferenceFactIds: row.preferenceFactIds,
		artifactRevisionIds: row.artifactRevisionIds,
		skillRevisionIds: row.skillRevisionIds,
		memoryFacts: row.memoryFacts as unknown as RunInputSnapshot["memoryFacts"],
		memoryQueryPolicy: row.memoryQueryPolicy as unknown as RunInputSnapshot["memoryQueryPolicy"],
		toolGrantIds: row.toolGrantIds,
		modelRoute: row.modelRoute as unknown as RunInputSnapshot["modelRoute"],
		budgetPolicy: row.budgetPolicy as unknown as RunInputSnapshot["budgetPolicy"],
		identitySnapshot: row.identitySnapshot as unknown as RunInputSnapshotIdentity,
		capabilitySetDigest: row.capabilitySetDigest,
		effectiveContractDigest: row.effectiveContractDigest,
		promptCompilerVersion: row.promptCompilerVersion,
		digest: row.digest,
		compiledAt: row.compiledAt.toISOString(),
	};
}

/** Derive a deterministic, attempt-scoped command id so retries reuse one idempotency key. */
function _commandId(context: RuntimeDispatchContext, sequence: number): string
{
	const canonical = JSON.stringify(["opencrane-runtime-command-id-v1", context.runId, context.attempt, sequence, context.assignmentDigest]);
	return `command-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/**
 * Choose the next lifecycle command that is due, or none.
 *
 * This foundation slice mints only `start_attempt`, once, while the run is live. Cancellation is not
 * a dispatched command: the pure authority closes admission during `cancelling` like any terminal
 * state, so cancellation is carried by fencing plus stream loss, and resume belongs to a later slice.
 */
function _decideKind(runState: RuntimeAdmissionRunState, commands: readonly DispatchedCommandRow[]): RuntimeCommandKind | null
{
	const hasStart = commands.some(function _isStart(row) { return row.kind === RuntimeCommandKind.StartAttempt; });
	if ((runState === "assigned" || runState === "running") && !hasStart) return RuntimeCommandKind.StartAttempt;
	return null;
}

/** Maps a Prisma run-state enum member to the lowercase admission-fence run state. */
function _toAdmissionRunState(state: PrismaAgentRunState): RuntimeAdmissionRunState
{
	switch (state)
	{
		case PrismaAgentRunState.Accepted: return "accepted";
		case PrismaAgentRunState.Queued: return "queued";
		case PrismaAgentRunState.Assigned: return "assigned";
		case PrismaAgentRunState.Running: return "running";
		case PrismaAgentRunState.WaitingForApproval: return "waiting_for_approval";
		case PrismaAgentRunState.Cancelling: return "cancelling";
		case PrismaAgentRunState.Completed: return "completed";
		case PrismaAgentRunState.Failed: return "failed";
		default: return "cancelled";
	}
}

/** Digest the immutable assignment identity so a command frame cannot silently rebind a run. */
function _computeAssignmentDigest(context: { runId: string; attempt: number; agentServiceId: string; agentRevisionId: string; siloId: string; subjectId: string; serviceAccountName: string; podUid: string; expiresAt: Date; createdAt: Date }): string
{
	const canonical = JSON.stringify(["opencrane-runtime-assignment-digest-v1", context.runId, context.attempt, context.agentServiceId, context.agentRevisionId, context.siloId, context.subjectId, context.serviceAccountName, context.podUid, context.expiresAt.toISOString(), context.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Parse the trusted execution identity fields from the immutable snapshot JSON. */
function _snapshotIdentity(value: unknown): { subjectUserId: string; fleetMembershipRevision: number } | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const identity = value as Record<string, unknown>;
	const subjectUserId = identity["executionSubjectId"];
	const fleetMembershipRevision = identity["fleetMembershipRevision"];
	if (typeof subjectUserId !== "string" || subjectUserId.trim().length === 0 || typeof fleetMembershipRevision !== "number" || !Number.isSafeInteger(fleetMembershipRevision) || fleetMembershipRevision < 0) return null;
	return { subjectUserId, fleetMembershipRevision };
}
