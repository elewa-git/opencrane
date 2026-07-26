import { createHash } from "node:crypto";

import { AgentRunState as PrismaAgentRunState, AgentRunTerminalReason, ApprovalRequestState, Prisma, RuntimeCommandKind, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";

import { AGENT_RUNTIME_PROTOCOL_V1, type CancelAttemptCommand, type CompiledRunInput, type ResumeAttemptCommand, type RunInputSnapshot, type RunInputSnapshotIdentity, type RuntimeAssignment, type RuntimeCandidate, type RuntimeCommand, type RuntimeCommandEnvelope, type RuntimeExternalActionCandidate, type RuntimeStreamOpen } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";

import { __AdmitRuntimeCandidate, __AdmitRuntimeCommand } from "./runtime-protocol-authority.js";
import type { RuntimeAdmissionRunState, RuntimeAttemptAuthority, RuntimeProtocolClock } from "./runtime-protocol-authority.types.js";
import type { RunInputCompiler, RuntimeCandidateDispatchResult, RuntimeDispatchAuthorityConfig, RuntimeExternalActionRunner, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types.js";

/** Fixed retry delay returned before an admitted action has a durable invocation receipt. */
const _EXTERNAL_ACTION_DISPATCH_RETRY_AFTER_MILLISECONDS = 1_000;

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
	/** Owning-run lifecycle state that gates every command and candidate. */
	readonly runState: RuntimeAdmissionRunState;
	/** Recorded terminal reason, present once the run is cancelling, that fixes the cancel body. */
	readonly terminalReason: AgentRunTerminalReason | null;
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
	/** Persisted resume payload for a resume frame, so redelivery survives resume-token consumption. */
	readonly payload: Prisma.JsonValue | null;
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
	/** Injected control-plane compiler that hydrates the snapshot carried on `start_attempt`. */
	private readonly compileRunInput: RunInputCompiler;
	/** Optional composition-root runner that reserves and dispatches admitted external actions. */
	private readonly externalActionRunner: RuntimeExternalActionRunner | null;
	/** Structured logger for dispatch failures that must be retried by the runtime. */
	private readonly log: Logger;

	/** Creates a dispatch adapter over canonical Postgres with a bounded command lifetime. */
	constructor(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, compileRunInput: RunInputCompiler, externalActionRunner?: RuntimeExternalActionRunner, clock?: RuntimeProtocolClock, log: Logger = ___CreateLogger("runtime-dispatch"))
	{
		if (!_configIsValid(config)) throw new Error("runtime dispatch authority requires a bounded namespace and command lifetime");
		this.prisma = prisma;
		this.config = config;
		this.compileRunInput = compileRunInput;
		this.externalActionRunner = externalActionRunner ?? null;
		this.clock = clock ?? { nowEpochMs(): number { return Date.now(); } };
		this.log = log;
	}

	/** Returns the next server-issued command after the supplied sequence, or null while idle. */
	async __NextCommand(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
	{
		if (identity.namespace !== this.config.namespace || open.podUid !== identity.podUid) return null;
		const prisma = this.prisma;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		return ___DoWithTrace("runtime_dispatch.command.next", { namespace: identity.namespace }, async function _traceNext(): Promise<RuntimeCommandEnvelope | null>
		{
			return _nextCommand(prisma, config, clock, compileRunInput, identity, open, afterSequence);
		});
	}

	/** Admits a runtime candidate through the pure authority and durably records acceptance. */
	async __AdmitCandidate(identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateDispatchResult>
	{
		if (identity.namespace !== this.config.namespace) return { accepted: false, reason: "namespace_mismatch" };
		const prisma = this.prisma;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		const externalActionRunner = this.externalActionRunner;
		const log = this.log;
		return ___DoWithTrace("runtime_dispatch.candidate.admit", { namespace: identity.namespace }, async function _traceAdmit(): Promise<RuntimeCandidateDispatchResult>
		{
			const admission = await _admitCandidate(prisma, clock, identity, candidate);
			// After the fence-checked admission commits, dispatch accepted external actions outside the
			// admission transaction. Only an explicit runner result that proves no ToolInvocation exists can
			// use the server-owned retry budget; every post-reservation outcome stays terminal and fail closed.
			if (admission.accepted && candidate.kind === "external_action" && externalActionRunner !== null)
			{
				const outcome = await _dispatchExternalAction(prisma, compileRunInput, externalActionRunner, identity, candidate);
				if (outcome.outcome === "denied") return { accepted: false, reason: "external_action_dispatch_denied" };
				if (outcome.outcome === "retryable")
				{
					const retry = await _recordExternalActionRetry(prisma, clock, config, candidate);
					log.error({ err: outcome.error, runId: candidate.runId, attempt: candidate.attempt, candidateId: candidate.candidateId, toolInvocationId: candidate.toolInvocationId, toolRevisionId: candidate.toolRevisionId, retryCount: retry.retryCount, failureKind: retry.result.retryable ? "external_action_dispatch_retryable" : "external_action_dispatch_retry_exhausted" }, "runtime external action dispatch failed before reservation");
					return retry.result;
				}
			}
			return admission;
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
		&& config.commandTtlMilliseconds <= 300_000
		&& Number.isSafeInteger(config.externalActionRetryLimit)
		&& config.externalActionRetryLimit >= 1
		&& config.externalActionRetryLimit <= 10
		&& Number.isSafeInteger(config.externalActionRetryWindowMilliseconds)
		&& config.externalActionRetryWindowMilliseconds >= 1_000
		&& config.externalActionRetryWindowMilliseconds <= 300_000;
}

/** Mint or redeliver one command for the connected runtime inside a single locked transaction. */
async function _nextCommand(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
{
	if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return null;
	return prisma.$transaction(async function _dispatch(transaction: Prisma.TransactionClient): Promise<RuntimeCommandEnvelope | null>
	{
		// 1. Load and lock the live assignment, run, and snapshot before any authority decision.
		const context = await _loadContext(transaction, identity);
		if (context === null) return null;

		// 2. Bind the stream to the connecting runtime instance so a stale instance cannot be served.
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
			// Rebuild the exact body from immutable state (or the stored resume payload) so a redelivered
			// frame is byte-identical even after the single-use resume token has been consumed.
			const extras = await _storedCommandExtras(transaction, context, stored, compileRunInput);
			if (extras === null) return null;
			const envelope = _rebuildEnvelope(context, runtimeInstanceId, stored, extras);
			const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
			return admission.outcome === "idempotent" ? envelope : null;
		}
		if (targetSequence !== stream.nextCommandSequence) return null;

		// 4. Decide whether a new lifecycle command is due, mint it, and admit it before persisting.
		const kind = await _decideKind(transaction, context, commands);
		if (kind === null) return null;
		const nowEpochMs = clock.nowEpochMs();
		const extras = await _mintCommandExtras(transaction, context, kind, stream.inputGeneration, compileRunInput);
		if (extras === null) return null;
		const envelope = _mintEnvelope(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, kind, nowEpochMs, config.commandTtlMilliseconds, extras);
		if (envelope === null) return null;
		const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
		if (admission.outcome !== "accepted") return null;

		// 5. Persist the accepted command (with any resume payload) and advance the sequence under lock.
		await transaction.runtimeDispatchedCommand.create({ data: { runId: context.runId, attempt: context.attempt, sequence: envelope.sequence, commandId: envelope.commandId, kind, fence: envelope.fence, payload: extras.resume === null ? Prisma.DbNull : extras.resume as unknown as Prisma.InputJsonValue, issuedAt: new Date(envelope.issuedAt), expiresAt: new Date(envelope.expiresAt) } });
		const advanced = await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, nextCommandSequence: stream.nextCommandSequence }, data: { nextCommandSequence: admission.nextCommandSequence } });
		if (advanced.count !== 1) throw new Error("runtime dispatch lost its command sequence fence");
		// Consume the single-use resume tokens so a duplicate resume can never re-dispatch the results.
		if (kind === RuntimeCommandKind.ResumeAttempt && extras.resumeApprovalIds.length > 0) await transaction.approvalRequest.updateMany({ where: { id: { in: [...extras.resumeApprovalIds] } }, data: { resumeTokenHash: null } });
		return envelope;
	});
}

/** Admit one runtime candidate and durably record its id when the pure authority accepts it. */
async function _admitCandidate(prisma: PrismaClient, clock: RuntimeProtocolClock, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateDispatchResult>
{
	return prisma.$transaction(async function _admit(transaction: Prisma.TransactionClient): Promise<RuntimeCandidateDispatchResult>
	{
		// 1. Load and lock the live assignment, run, and snapshot for the reviewed Pod.
		const context = await _loadContext(transaction, identity);
		if (context === null) return { accepted: false, reason: "unknown_workload" };
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

/** Reserve and dispatch one admitted external-action candidate through the composition-root runner. */
async function _dispatchExternalAction(prisma: PrismaClient, compileRunInput: RunInputCompiler, runner: RuntimeExternalActionRunner, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeExternalActionCandidate): ReturnType<RuntimeExternalActionRunner["run"]>
{
	// Reload the immutable snapshot and recompile its granted tools so the runner validates the
	// candidate's revision against the exact authority the attempt was admitted under.
	let loaded: { snapshot: RunInputSnapshot; tools: CompiledRunInput["tools"] } | null;
	try
	{
		loaded = await prisma.$transaction(async function _load(transaction: Prisma.TransactionClient): Promise<{ snapshot: RunInputSnapshot; tools: CompiledRunInput["tools"] } | null>
		{
			const context = await _loadContext(transaction, identity);
			if (context === null || context.runId !== candidate.runId || context.attempt !== candidate.attempt) return null;
			const compiled = await compileRunInput(context.snapshot, transaction);
			return { snapshot: context.snapshot, tools: compiled.tools };
		});
	}
	catch (error)
	{
		return { outcome: "retryable", error };
	}
	if (loaded === null) return { outcome: "denied" };
	return runner.run(candidate, loaded.snapshot, loaded.tools);
}

/** Consume one durable retry slot after the runner proves no invocation reservation exists. */
async function _recordExternalActionRetry(prisma: PrismaClient, clock: RuntimeProtocolClock, config: RuntimeDispatchAuthorityConfig, candidate: RuntimeExternalActionCandidate): Promise<{ result: RuntimeCandidateDispatchResult; retryCount: number }>
{
	const now = new Date(clock.nowEpochMs());
	return prisma.$transaction(async function _record(transaction: Prisma.TransactionClient): Promise<{ result: RuntimeCandidateDispatchResult; retryCount: number }>
	{
		const key = { runId: candidate.runId, attempt: candidate.attempt, candidateId: candidate.candidateId };
		const existing = await transaction.runtimeExternalActionRetry.findUnique({ where: { runId_attempt_candidateId: key } });
		if (existing === null)
		{
			await transaction.runtimeExternalActionRetry.create({ data: { ...key, retryCount: 1, retryDeadlineAt: new Date(now.getTime() + config.externalActionRetryWindowMilliseconds) } });
			return { result: { accepted: false, reason: "external_action_dispatch_retryable", retryable: true, retryAfterMilliseconds: _EXTERNAL_ACTION_DISPATCH_RETRY_AFTER_MILLISECONDS }, retryCount: 1 };
		}
		if (existing.retryCount >= config.externalActionRetryLimit || existing.retryDeadlineAt.getTime() <= now.getTime()) return { result: { accepted: false, reason: "external_action_dispatch_retry_exhausted" }, retryCount: existing.retryCount };
		const updated = await transaction.runtimeExternalActionRetry.updateMany({ where: { ...key, retryCount: existing.retryCount }, data: { retryCount: { increment: 1 } } });
		if (updated.count !== 1) throw new Error("runtime dispatch lost its external action retry fence");
		return { result: { accepted: false, reason: "external_action_dispatch_retryable", retryable: true, retryAfterMilliseconds: _EXTERNAL_ACTION_DISPATCH_RETRY_AFTER_MILLISECONDS }, retryCount: existing.retryCount + 1 };
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
		runState: _toAdmissionRunState(run.state),
		terminalReason: run.terminalReason,
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

/** Kind-specific data assembled deterministically from immutable state for one command body. */
interface CommandExtras
{
	/** Control-plane-hydrated literal input required by a `start_attempt` frame. */
	readonly compiledInput: CompiledRunInput | null;
	/** Authorized deferred-result payload required by a `resume_attempt` frame. */
	readonly resume: ResumeAttemptCommand | null;
	/** Approval rows whose single-use resume tokens this resume frame consumes when minted. */
	readonly resumeApprovalIds: readonly string[];
	/** Server-defined stop reason carried by a `cancel_attempt` frame. */
	readonly cancelReason: CancelAttemptCommand["reason"];
}

/** Rebuild a stored command's exact envelope for idempotent redelivery on reconnect. */
function _rebuildEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, row: DispatchedCommandRow, extras: CommandExtras): RuntimeCommandEnvelope
{
	const command = _commandBody(context, row.kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: row.commandId, sequence: row.sequence, fence: row.fence, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/** Mint a fresh command envelope bounded by the assignment lease, or null when it cannot be valid. */
function _mintEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, sequence: number, kind: RuntimeCommandKind, nowEpochMs: number, commandTtlMilliseconds: number, extras: CommandExtras): RuntimeCommandEnvelope | null
{
	// 1. Bound the command lifetime by the assignment lease so a frame never outlives its authority.
	const expiresAtEpochMs = Math.min(nowEpochMs + commandTtlMilliseconds, context.leaseExpiresAtEpochMs);
	if (nowEpochMs >= expiresAtEpochMs) return null;

	// 2. Assemble the canonical frame; the pure authority still fences, orders, and validates it.
	const command = _commandBody(context, kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: _commandId(context, sequence), sequence, fence, issuedAt: new Date(nowEpochMs).toISOString(), expiresAt: new Date(expiresAtEpochMs).toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/**
 * Build the kind-specific command body carried by the envelope.
 *
 * `start_attempt` carries the immutable snapshot and its control-plane-compiled literal input;
 * `resume_attempt` carries the current input generation and the control-plane-authorized deferred
 * tool results that unblock a paused attempt; `cancel_attempt` carries only a server-defined stop
 * reason. Every field is reconstructed from immutable durable state so a redelivered frame is
 * byte-identical to its mint.
 */
function _commandBody(context: RuntimeDispatchContext, kind: RuntimeCommandKind, extras: CommandExtras): RuntimeCommand
{
	if (kind === RuntimeCommandKind.CancelAttempt) return { kind: "cancel_attempt", payload: { reason: extras.cancelReason } };
	if (kind === RuntimeCommandKind.ResumeAttempt)
	{
		if (extras.resume === null) throw new Error("runtime dispatch requires authorized deferred results for a resume_attempt frame");
		return { kind: "resume_attempt", payload: extras.resume };
	}
	if (extras.compiledInput === null) throw new Error("runtime dispatch requires compiled input for a start_attempt frame");
	return { kind: "start_attempt", payload: { snapshot: context.snapshot, compiledInput: extras.compiledInput } };
}

/** Assemble the body data for a freshly minted command from the immutable durable state. */
async function _mintCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, kind: RuntimeCommandKind, inputGeneration: number, compileRunInput: RunInputCompiler): Promise<CommandExtras | null>
{
	if (kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await compileRunInput(context.snapshot, transaction);
		return { compiledInput, resume: null, resumeApprovalIds: [], cancelReason: "cancelled" };
	}
	if (kind === RuntimeCommandKind.CancelAttempt) return { compiledInput: null, resume: null, resumeApprovalIds: [], cancelReason: _cancelReason(context.terminalReason) };
	const loaded = await _loadResume(transaction, context, inputGeneration);
	if (loaded === null) return null;
	return { compiledInput: null, resume: loaded.resume, resumeApprovalIds: loaded.approvalIds, cancelReason: "cancelled" };
}

/** Rebuild the body data for a stored command on redelivery, reading a resume payload from its row. */
async function _storedCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, row: DispatchedCommandRow, compileRunInput: RunInputCompiler): Promise<CommandExtras | null>
{
	if (row.kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await compileRunInput(context.snapshot, transaction);
		return { compiledInput, resume: null, resumeApprovalIds: [], cancelReason: "cancelled" };
	}
	if (row.kind === RuntimeCommandKind.CancelAttempt) return { compiledInput: null, resume: null, resumeApprovalIds: [], cancelReason: _cancelReason(context.terminalReason) };
	const resume = _resumeFromPayload(row.payload);
	if (resume === null) return null;
	return { compiledInput: null, resume, resumeApprovalIds: [], cancelReason: "cancelled" };
}

/** Parse a persisted resume payload back into the exact frame it was minted from. */
function _resumeFromPayload(payload: Prisma.JsonValue | null): ResumeAttemptCommand | null
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload as { readonly [key: string]: JsonValue };
	if (typeof record["inputGeneration"] !== "number" || !("deferredToolResults" in record)) return null;
	return { inputGeneration: record["inputGeneration"], deferredToolResults: record["deferredToolResults"] };
}

/** Map a durable run terminal reason to the server-defined cancellation reason the runtime receives. */
function _cancelReason(terminalReason: AgentRunTerminalReason | null): CancelAttemptCommand["reason"]
{
	if (terminalReason === AgentRunTerminalReason.BudgetExhausted) return "budget_exhausted";
	if (terminalReason === AgentRunTerminalReason.PolicyDenied) return "capability_revoked";
	return "cancelled";
}

/**
 * Assemble the authorized deferred-result payload for a resume frame from approved approvals.
 *
 * It gathers every Approved deferred-tool approval for the attempt whose single-use resume token has
 * not been consumed (`resumeTokenHash` still set), ordered by id so the payload is deterministic, and
 * returns the current input generation with the ordered results plus the approval ids to consume on
 * mint. Once consumed, a duplicate resume finds nothing and is a no-op rather than a re-execution.
 * Returns null when no unconsumed approved result exists.
 */
async function _loadResume(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, inputGeneration: number): Promise<{ resume: ResumeAttemptCommand; approvalIds: string[] } | null>
{
	const approvals = await transaction.approvalRequest.findMany({ where: { runId: context.runId, attempt: context.attempt, state: ApprovalRequestState.Approved, toolInvocationRowId: { not: null }, resumeTokenHash: { not: null } }, orderBy: { id: "asc" } });
	if (approvals.length === 0) return null;
	const deferredToolResults = approvals.map(function _result(row): JsonValue { return row.deferredToolResult as JsonValue; });
	return { resume: { inputGeneration, deferredToolResults }, approvalIds: approvals.map(function _id(row) { return row.id; }) };
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
 * `start_attempt` is minted once while the run is assigned or running. `cancel_attempt` is minted
 * once while the run is `cancelling` as a POSITIVE stop signal the runtime acts on immediately; it is
 * additive to — never a replacement for — the fence bump and stream loss that already bound a
 * cancelled attempt, so cancellation still holds if the runtime never receives the frame.
 * `resume_attempt` is minted while the run is running once at least one approved deferred-tool result
 * is ready and no resume has yet been dispatched, feeding the authorized results back into the loop.
 */
async function _decideKind(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, commands: readonly DispatchedCommandRow[]): Promise<RuntimeCommandKind | null>
{
	const runState = context.runState;
	const hasStart = commands.some(function _isStart(row) { return row.kind === RuntimeCommandKind.StartAttempt; });
	if (runState === "cancelling") return commands.some(function _isCancel(row) { return row.kind === RuntimeCommandKind.CancelAttempt; }) ? null : RuntimeCommandKind.CancelAttempt;
	if ((runState === "assigned" || runState === "running") && !hasStart) return RuntimeCommandKind.StartAttempt;
	if (runState === "running" && hasStart && !commands.some(function _isResume(row) { return row.kind === RuntimeCommandKind.ResumeAttempt; }))
	{
		const loaded = await _loadResume(transaction, context, 0);
		if (loaded !== null) return RuntimeCommandKind.ResumeAttempt;
	}
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
