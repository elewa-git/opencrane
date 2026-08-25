import { createHash } from "node:crypto";
import { AgentRunState as PrismaAgentRunState, AgentRunTerminalReason, Prisma, RuntimeCommandKind, RuntimeSteeringRequestState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";

import type { RuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, AGENT_RUNTIME_PROTOCOL_V1, ElicitationPurposes, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, RunInputSnapshotIdentityKinds, RuntimeCandidateKinds, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName, type CancelAttemptCommand, type CompiledRunInput, type ResumeAttemptCommand, type RunInputSnapshot, type RuntimeAssignment, type RuntimeAssignmentIdentity, type RuntimeCandidate, type RuntimeCommand, type RuntimeCommandEnvelope, type RuntimeElicitationCandidate, type RuntimeExternalActionCandidate, type RuntimeStreamOpen } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ExternalActionRecoveryModes, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationAdmissionOutcomes, __AdmitPreparingToolInvocationInTransaction, __DigestCanonicalJson, __ValidateDeferredToolArguments, type ToolInvocationIntent } from "@opencrane/backend/server/iam/authorization";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION, RunEventTypes } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { _CompileRunInputForContext } from "./compiled-run-input-context";
import { _ApplyRuntimeCandidateSideEffects, _RuntimeCandidateRequiresEventReporter, RuntimeCandidateSideEffectDeniedError } from "./prisma-runtime-candidate-side-effects";
import { PrismaRuntimeCommandDecisionUnitOfWork } from "./prisma-runtime-command-decision-unit-of-work";
import { PrismaRuntimeDispatchStateUnitOfWork } from "./prisma-runtime-dispatch-state-repository";
import { PrismaRuntimeResumeInputUnitOfWork } from "./prisma-runtime-resume-input-repository";
import { __ProjectRuntimeInputSnapshot } from "./runtime-input-snapshot-projector";
import { _ParseRuntimeResumeInput } from "./runtime-resume-input";
import { __AdmitRuntimeCandidate, __AdmitRuntimeCommand } from "./runtime-protocol-authority";
import { RuntimeAdmissionOutcomes, type RuntimeAdmissionRunState, type RuntimeAttemptAuthority, type RuntimeProtocolClock } from "./runtime-protocol-authority.types";
import type { RunInputCompiler, RuntimeApprovalExpiry, RuntimeCandidateDispatchResult, RuntimeDispatchAuthorityConfig, RuntimeElicitationUnitOfWorkFactory, RuntimeEventReporter, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";

/** Database facts about one connected runtime Pod's run and assignment, read under a row lock. */
interface RuntimeDispatchContext
{
	/** Run authorised for the connected Pod. */
	readonly runId: string;
	/** Run attempt this workload assignment was issued for; always 1 or more. */
	readonly attempt: number;
	/** AgentService executed by the workload. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision the runtime runs. */
	readonly agentRevisionId: string;
	/** Silo in which the assignment is valid. */
	readonly siloId: string;
	/** State of the owning run. Every command and candidate is checked against it. */
	readonly runState: RuntimeAdmissionRunState;
	/** Why the run is ending. Set once the run is cancelling, and it decides the reason sent in the cancel command. */
	readonly terminalReason: AgentRunTerminalReason | null;
	/** Digest of the assignment's fixed identity fields; every command carries it. */
	readonly assignmentDigest: string;
	/** Digest of the input snapshot for this attempt; it never changes. */
	readonly inputSnapshotDigest: string;
	/** The immutable input snapshot sent in the start-attempt command. */
	readonly snapshot: RunInputSnapshot;
	/** Agent-session conversation derived from the locked snapshot. */
	readonly conversationId: string | null;
	/** Approved persona revision compiled for the run, when present. */
	readonly personaRevisionId: string | null;
	/** Who the run acts as: a user or a managed service. Its fleet-membership check authorised the run. */
	readonly identity: RuntimeAssignmentIdentity;
	/** Digest of the capability set proved for this attempt. */
	readonly capabilitySetDigest: string;
	/** Expected Kubernetes ServiceAccount name for the runtime workload. */
	readonly serviceAccountName: string;
	/** Registered runtime Pod UID bound to the assignment. */
	readonly podUid: string;
	/** When the assignment lease expires, in epoch milliseconds. It is never extended. */
	readonly leaseExpiresAtEpochMs: number;
	/** When the assignment was issued; every command repeats this value. */
	readonly assignmentIssuedAt: string;
	/** When the assignment expires; every command repeats this value. */
	readonly assignmentExpiresAt: string;
}

/** Fields of a stored command row, enough to re-send that command or to check it against the sequence. */
interface DispatchedCommandRow
{
	/** Idempotency key the server assigned to this command. */
	readonly commandId: string;
	/** Strictly monotonic command sequence for the attempt. */
	readonly sequence: number;
	/** Which kind of command was saved. */
	readonly kind: RuntimeCommandKind;
	/** Lease fence the server set, sent with this command. */
	readonly fence: number;
	/** Saved payload of a resume command, so it can be re-sent even after its tool-result rows are marked consumed. */
	readonly payload: Prisma.JsonValue | null;
	/** When this command was issued. */
	readonly issuedAt: Date;
	/** When this command expires. */
	readonly expiresAt: Date;
}

/**
 * Sends commands to a connected runtime Pod, and decides whether to accept what that Pod proposes.
 *
 * This is the whole server side of the runtime protocol. A runtime Pod holds one long-lived stream
 * and polls {@link PrismaRuntimeDispatchAuthority.__NextCommand} for work; anything it wants to do
 * that outlives itself - record an event, call an external tool - it must first offer to
 * {@link PrismaRuntimeDispatchAuthority.__AdmitCandidate}. The Pod is never trusted: for the Pod
 * that is asking, this class loads and row-locks the live WorkloadAssignment, its AgentRun, and the
 * immutable RunInputSnapshot, then hands every allow-or-deny decision to `__AdmitRuntimeCommand` /
 * `__AdmitRuntimeCandidate`, which touch no database.
 *
 * Two rules hold the design together. A command is only created if those decision functions accept
 * it, and the command sequence number and the list of accepted candidate ids move forward in the
 * same transaction that saves the command, so a bug in the wire format or the transport cannot
 * reorder work or run it twice. And a command sent again after a reconnect is rebuilt from saved
 * data that cannot change, so it is byte-for-byte the same as the first send, and the runtime may
 * safely treat the repeat as the same command.
 *
 * Called by: constructed only by `__CreateProductionRuntimeDispatchAuthority`
 * (production-runtime-dispatch.ts), which apps/opencrane/src/app/runtime-composition.ts passes to
 * `_RegisterInternalAgentRuntimeStream` as its `authority` port. That transport
 * (libs/backend/server/infra/agent-runtime-stream/src/agent-runtime-stream.ts) is the only caller
 * of the three public methods.
 *
 * @see __CreateProductionRuntimeDispatchAuthority for the production wiring.
 * @see RuntimeCandidateDispatchResult for what a refusal obliges the transport to do.
 */
export class PrismaRuntimeDispatchAuthority
{
	/** Client for the main OpenCrane database. */
	private readonly prisma: PrismaClient;
	/** The two runtime namespaces, and how long a command stays valid. */
	private readonly config: RuntimeDispatchAuthorityConfig;
	/** Trusted server clock, never a runtime-supplied time. */
	private readonly clock: RuntimeProtocolClock;
	/** Turns the snapshot into the literal input sent with `start_attempt`. */
	private readonly compileRunInput: RunInputCompiler;
	/** Optional port that saves runtime events; the composition root supplies it. */
	private readonly eventReporter: RuntimeEventReporter | null;
	/** Optional port that closes approvals whose deadline has passed. */
	private readonly approvalExpiry: RuntimeApprovalExpiry | null;
	/** Creates generic request work bound to each exact dispatch transaction. */
	private readonly elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory;

	/**
	 * Creates the dispatcher over Postgres.
	 *
	 * @param prisma - Client for the main OpenCrane database.
	 * @param config - The two runtime namespaces, and how long a command stays valid.
	 * @param compileRunInput - Turns a snapshot into the input sent with `start_attempt`.
	 * @param eventReporter - Saves runtime events. When omitted, a candidate carrying an event is
	 * refused with `event_reporter_unavailable` rather than accepted without its event.
	 * @param clock - Server clock; defaults to `Date.now`. Pass one in tests to fix the time.
	 * @param approvalExpiry - Closes approvals whose deadline has passed. When omitted, a run waiting
	 * for approval never advances: `__NextCommand` returns null instead of guessing the wait is over.
	 * @param elicitationUnitOfWorkFactory - Binds generic participant request work to each dispatch
	 * transaction. It is required because runtime proposals and expiry share the dispatch lock.
	 * @throws {Error} When `config` does not hold two different valid namespaces and a command
	 * lifetime between 1s and 300s. Thrown at construction, so a misconfigured deployment fails at
	 * startup instead of mid-stream.
	 */
	constructor(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, compileRunInput: RunInputCompiler, eventReporter: RuntimeEventReporter | undefined, clock: RuntimeProtocolClock | undefined, approvalExpiry: RuntimeApprovalExpiry | undefined, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory)
	{
		if (!_configIsValid(config)) throw new Error("runtime dispatch authority requires distinct bounded runtime namespaces and command lifetime");
		this.prisma = prisma;
		this.config = config;
		this.compileRunInput = compileRunInput;
		this.clock = clock ?? { nowEpochMs(): number { return Date.now(); } };
		this.eventReporter = eventReporter ?? null;
		this.approvalExpiry = approvalExpiry ?? null;
		this.elicitationUnitOfWorkFactory = elicitationUnitOfWorkFactory;
	}

	/**
	 * Returns the next command for this runtime, or null when there is nothing to send.
	 *
	 * `null` is the normal, common answer and never means "error". It covers every case where the
	 * runtime should simply wait and poll again: no command is due yet, this Pod is not the instance
	 * bound to the stream, the namespace is not a configured runtime namespace, the run has finished,
	 * or a run waiting for approval could not be advanced. The transport must not treat null as a
	 * failure or close the stream; it waits for a wakeup or the recovery timer and calls again.
	 *
	 * A command already stored at `afterSequence + 1` is rebuilt and returned again, byte-for-byte
	 * identical to the first send, so a runtime that reconnected and lost a frame can be caught up
	 * safely. While the run is cancelling, the stored cancel command is returned instead.
	 *
	 * Called by: the command pump in
	 * libs/backend/server/infra/agent-runtime-stream/src/agent-runtime-stream.ts:166, through the
	 * `RuntimeCommandStreamAuthority` port.
	 *
	 * @param identity - Pod identity the transport already verified with TokenReview.
	 * @param open - The stream-open message, naming the runtime instance and Pod UID.
	 * @param afterSequence - Highest command sequence the runtime has already seen; 0 on a new stream.
	 * @returns The next command to send, or null when the runtime should wait and poll again.
	 * @see __AdmitCandidate for the runtime-to-server direction.
	 */
	async __NextCommand(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
	{
		if (!_IsConfiguredRuntimeNamespace(identity.namespace, this.config) || open.podUid !== identity.podUid) return null;
		const prisma = this.prisma;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		const approvalExpiry = this.approvalExpiry;
		const elicitationUnitOfWorkFactory = this.elicitationUnitOfWorkFactory;
		return ___DoWithTrace("runtime_dispatch.command.next", { namespace: identity.namespace }, async function _traceNext(): Promise<RuntimeCommandEnvelope | null>
		{
			return _nextCommand(prisma, config, clock, compileRunInput, approvalExpiry, elicitationUnitOfWorkFactory, identity, open, afterSequence);
		});
	}

	/**
	 * Decides whether one thing the runtime proposes may happen, and saves it when it may.
	 *
	 * Accepting is durable: the event row, or the ToolInvocation row for an external action, is
	 * written in the same transaction that records the candidate id, so the runtime can crash right
	 * after the answer without the work being lost or repeated. Offering the same candidate id twice
	 * returns `accepted: true` again, but only when the repeat carries identical arguments.
	 *
	 * Called by: the `/candidates` route in
	 * libs/backend/server/infra/agent-runtime-stream/src/agent-runtime-stream.ts:204.
	 *
	 * @param identity - Pod identity the transport already verified with TokenReview.
	 * @param candidate - The event or external action the runtime is proposing.
	 * @returns `accepted: true` when the proposal is now durable and the runtime may carry on.
	 * `accepted: false` with a `reason` when it must not: the runtime must not perform the proposed
	 * effect, and the transport answers 409. {@link RuntimeCandidateDispatchResult} groups the reasons
	 * by what each one obliges the runtime to do.
	 * @throws Rethrows any database error that is not a candidate refusal, so a broken transaction
	 * surfaces as a 5xx instead of being reported to the runtime as a clean refusal.
	 * @see RuntimeCandidateDispatchResult
	 */
	async __AdmitCandidate(identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate): Promise<RuntimeCandidateDispatchResult>
	{
		if (!_IsConfiguredRuntimeNamespace(identity.namespace, this.config)) return { accepted: false, reason: "namespace_mismatch" };
		const prisma = this.prisma;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		const eventReporter = this.eventReporter;
		const elicitationUnitOfWorkFactory = this.elicitationUnitOfWorkFactory;
		return ___DoWithTrace("runtime_dispatch.candidate.admit", { namespace: identity.namespace }, async function _traceAdmit(): Promise<RuntimeCandidateDispatchResult>
		{
			return _admitCandidate(prisma, config, clock, compileRunInput, identity, candidate, eventReporter, elicitationUnitOfWorkFactory);
		});
	}

	/**
	 * Unbinds the runtime instance from its stream after the connection is lost.
	 *
	 * A stream row remembers which runtime instance owns it, and `__NextCommand` refuses to serve any
	 * other instance. Without this call that binding would outlive the dead Pod, and its replacement
	 * would be refused every command until the assignment lease expired. Only the instance named in
	 * `open` can release the binding, so a late call from an older instance cannot take the stream
	 * away from the one now connected; when the binding has already moved, this does nothing.
	 *
	 * Called by: the stream cleanup handler in
	 * libs/backend/server/infra/agent-runtime-stream/src/agent-runtime-stream.ts:146, on response
	 * close or error. That caller deliberately ignores any rejection, so release is best-effort and
	 * the assignment lease is the backstop.
	 *
	 * @param identity - Pod identity the transport verified when the stream opened.
	 * @param open - The stream-open message of the connection that is closing.
	 * @returns Nothing.
	 */
	async __ReleaseStream(identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
	{
		if (!_IsConfiguredRuntimeNamespace(identity.namespace, this.config) || open.podUid !== identity.podUid) return;
		const prisma = this.prisma;
		const config = this.config;
		await ___DoWithTrace("runtime_dispatch.stream.release", { namespace: identity.namespace }, async function _traceRelease(): Promise<void>
		{
			await _releaseStream(prisma, config, identity, open);
		});
	}
}
/** Validate fixed dispatch policy before any database transaction begins. */
function _configIsValid(config: RuntimeDispatchAuthorityConfig): boolean
{
	return _IsNamespace(config.personalRuntimeNamespace)
		&& _IsNamespace(config.managedRuntimeNamespace)
		&& config.personalRuntimeNamespace !== config.managedRuntimeNamespace
		&& Number.isSafeInteger(config.commandTtlMilliseconds)
		&& config.commandTtlMilliseconds >= 1_000
		&& config.commandTtlMilliseconds <= 300_000;
}
/** Return whether this namespace is one of the two configured runtime namespaces. */
function _IsConfiguredRuntimeNamespace(namespace: string, config: RuntimeDispatchAuthorityConfig): boolean
{
	return namespace === config.personalRuntimeNamespace || namespace === config.managedRuntimeNamespace;
}
/** Return whether this value is a valid Kubernetes namespace name. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}
/** Create a new command, or re-send a stored one, inside a single locked transaction. */
async function _nextCommand(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, approvalExpiry: RuntimeApprovalExpiry | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
{
	if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return null;
	return prisma.$transaction(async function _dispatch(transaction: Prisma.TransactionClient): Promise<RuntimeCommandEnvelope | null>
	{
		const elicitationUnitOfWork = elicitationUnitOfWorkFactory.bind(transaction);
		// 1. Load and lock the live assignment, run, and snapshot before any authority decision.
		let context = await _loadContext(transaction, config, identity);
		if (context === null) return null;
		// An attempt waiting for approval cannot move on until overdue approvals are closed. That runs
		// in this same transaction and under the same run lock, and then the context is read again, so
		// the next command is chosen from what the database says now, not from the values read earlier.
		const decisionUnitOfWork = new PrismaRuntimeCommandDecisionUnitOfWork(transaction);
		const expiry = await decisionUnitOfWork.expireWaiting(context, approvalExpiry, elicitationUnitOfWork, new Date(clock.nowEpochMs()));
		if (expiry === "unavailable") return null;
		if (expiry === "applied")
		{
			context = await _loadContext(transaction, config, identity);
			if (context === null) return null;
		}

		// 2. Bind the stream to the connecting runtime instance so a stale instance cannot be served.
		const runtimeInstanceId = await _bindRuntimeInstance(transaction, context, open.runtimeInstanceId);
		if (runtimeInstanceId === null) return null;
		const stream = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
		if (stream === null) return null;
		const commands = await transaction.runtimeDispatchedCommand.findMany({ where: { runId: context.runId, attempt: context.attempt }, orderBy: { sequence: "asc" } });
		const authority = _buildAuthority(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);

		// 3. Redeliver a stored command the transport has not yet re-sent on this connection.
		const targetSequence = afterSequence + 1;
		// A cancel replaces older work: while cancelling, send the saved cancel command, which is the one row with a sequence higher than what the runtime has already seen.
		const stored = context.runState === "cancelling" ? commands.find(function _UnobservedCancel(row) { return row.kind === RuntimeCommandKind.CancelAttempt && row.sequence > afterSequence; }) : commands.find(function _AtTarget(row) { return row.sequence === targetSequence; });
		if (stored)
		{
			// Rebuild the body from data that cannot change (or from the saved resume payload), so a
			// re-sent command is byte-for-byte the same even after its tool-result rows were consumed.
			const extras = await _storedCommandExtras(transaction, context, stored, compileRunInput);
			if (extras === null) return null;
			const envelope = _rebuildEnvelope(context, runtimeInstanceId, stored, extras);
			const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
			return admission.outcome === RuntimeAdmissionOutcomes.Idempotent ? envelope : null;
		}
		if (context.runState !== "cancelling" && targetSequence !== stream.nextCommandSequence) return null;

		// 4. Decide whether a new command is due, build it, and check it before saving it.
		const kind = await decisionUnitOfWork.decide(context, commands);
		if (kind === null) return null;
		const nowEpochMs = clock.nowEpochMs();
		const extras = await _mintCommandExtras(transaction, context, kind, stream.inputGeneration, compileRunInput);
		if (extras === null) return null;
		const envelope = _mintEnvelope(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, kind, nowEpochMs, config.commandTtlMilliseconds, extras);
		if (envelope === null) return null;
		const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
		if (admission.outcome !== RuntimeAdmissionOutcomes.Accepted) return null;
		// 5. Persist the accepted command (with any resume payload) and advance the sequence under lock.
		await transaction.runtimeDispatchedCommand.create({ data: { runId: context.runId, attempt: context.attempt, sequence: envelope.sequence, commandId: envelope.commandId, kind, fence: envelope.fence, payload: extras.resume === null ? Prisma.DbNull : extras.resume as unknown as Prisma.InputJsonValue, issuedAt: new Date(envelope.issuedAt), expiresAt: new Date(envelope.expiresAt) } });
		const advanced = await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, nextCommandSequence: stream.nextCommandSequence }, data: { nextCommandSequence: admission.nextCommandSequence } });
		if (advanced.count !== 1) throw new Error("runtime dispatch lost its command sequence fence");
		// Mark the tool-result rows consumed only after the command that carries them is saved.
		const stateUnitOfWork = kind === RuntimeCommandKind.ResumeAttempt ? new PrismaRuntimeDispatchStateUnitOfWork(transaction) : null;
		if (stateUnitOfWork !== null && extras.resumeToolResultDeliveryIds.length > 0)
			await stateUnitOfWork.consumeToolResultDeliveries(extras.resumeToolResultDeliveryIds, new Date(nowEpochMs));
		if (stateUnitOfWork !== null && extras.resumeElicitationResultDeliveryIds.length > 0)
			await stateUnitOfWork.consumeElicitationResultDeliveries(extras.resumeElicitationResultDeliveryIds, new Date(nowEpochMs));
		if (kind === RuntimeCommandKind.ResumeAttempt && extras.resumeSteeringRequestIds.length > 0) await transaction.runtimeSteeringRequest.updateMany({ where: { id: { in: [...extras.resumeSteeringRequestIds] }, state: RuntimeSteeringRequestState.Pending }, data: { state: RuntimeSteeringRequestState.Consumed, consumedAt: new Date(nowEpochMs) } });
		return envelope;
	});
}
/** Admit one runtime candidate and durably record its id when the pure authority accepts it. */
async function _admitCandidate(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate, eventReporter: RuntimeEventReporter | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory): Promise<RuntimeCandidateDispatchResult>
{
	if (candidate.kind === RuntimeCandidateKinds.Event && candidate.eventType === RunEventTypes.RunCancelled) return { accepted: false, reason: "runtime_cancellation_not_authoritative" };
	if (_RuntimeCandidateRequiresEventReporter(candidate) && eventReporter === null) return { accepted: false, reason: "event_reporter_unavailable" };
	try
	{
		return await prisma.$transaction(async function _admit(transaction: Prisma.TransactionClient): Promise<RuntimeCandidateDispatchResult>
		{
			const elicitationUnitOfWork = elicitationUnitOfWorkFactory.bind(transaction);
			// 1. Load and lock the live assignment, run, and snapshot for the Pod that is asking.
			const context = await _loadContext(transaction, config, identity);
			if (context === null) return { accepted: false, reason: "unknown_workload" };
			const stream = await transaction.runtimeCommandStream.findUnique({ where: { runId_attempt: { runId: context.runId, attempt: context.attempt } } });
			if (stream === null || stream.runtimeInstanceId === null) return { accepted: false, reason: "no_active_stream" };
			const commands = await transaction.runtimeDispatchedCommand.findMany({ where: { runId: context.runId, attempt: context.attempt }, orderBy: { sequence: "asc" } });
			const authority = _buildAuthority(context, stream.runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);
			// 2. Delegate the allow-or-deny decision to the pure candidate authority.
			const admission = __AdmitRuntimeCandidate({ authority, candidate, clock });
			if (admission.outcome === RuntimeAdmissionOutcomes.Idempotent)
			{
				if (candidate.kind === RuntimeCandidateKinds.Elicitation)
				{
					return await _OpenRuntimeElicitation(context, candidate, elicitationUnitOfWork, new Date(clock.nowEpochMs())) ? { accepted: true } : { accepted: false, reason: "elicitation_replay_conflict" };
				}
				if (candidate.kind !== RuntimeCandidateKinds.ExternalAction) return { accepted: true };
				const stateUnitOfWork = new PrismaRuntimeDispatchStateUnitOfWork(transaction);
				const invocation = await stateUnitOfWork.findToolInvocation(candidate.runId, candidate.attempt, candidate.candidateId);
				const actualArgumentsDigest = __DigestCanonicalJson(candidate.arguments);
				const requestFingerprint = _ToolInvocationFingerprint(candidate, actualArgumentsDigest);
				return invocation !== null && actualArgumentsDigest === candidate.argumentsDigest && invocation.runtimeInstanceId === candidate.runtimeInstanceId && invocation.commandId === candidate.commandId && invocation.toolRevisionId === candidate.toolRevisionId && invocation.toolInvocationId === candidate.toolInvocationId && invocation.argumentsDigest === actualArgumentsDigest && invocation.requestFingerprint === requestFingerprint ? { accepted: true } : { accepted: false, reason: "external_action_replay_conflict" };
			}
			if (admission.outcome === RuntimeAdmissionOutcomes.Denied) return { accepted: false, reason: admission.reason };
			const sourceCommand = commands.find(function _MatchesCandidate(row) { return row.commandId === candidate.commandId; });
			if (sourceCommand === undefined) return { accepted: false, reason: "command_not_accepted" };
			// 2b. Persist complete provider-free work authority before accepting an external action.
			if (candidate.kind === RuntimeCandidateKinds.ExternalAction)
			{
				const intent = await _toolInvocationIntent(transaction, context, stream.runtimeInstanceId, candidate, compileRunInput);
				if (intent === null) return { accepted: false, reason: "external_action_invalid" };
				const durable = await __AdmitPreparingToolInvocationInTransaction(transaction, intent, new Date(clock.nowEpochMs()), TOOL_INVOCATION_PREPARATION_POLICY);
				if (durable.outcome === ToolInvocationAdmissionOutcomes.Conflict) return { accepted: false, reason: "external_action_conflict" };
			}
			if (candidate.kind === RuntimeCandidateKinds.Elicitation)
			{
				if (!await _OpenRuntimeElicitation(context, candidate, elicitationUnitOfWork, new Date(clock.nowEpochMs()))) return { accepted: false, reason: "elicitation_invalid" };
			}
			// 2c. Apply transaction-local canonical event effects before accepting the id.
			const sideEffectDenial = await _ApplyRuntimeCandidateSideEffects(transaction, candidate, context.runId, context.attempt, sourceCommand.kind === RuntimeCommandKind.StartAttempt, eventReporter);
			if (sideEffectDenial !== null) return { accepted: false, reason: sideEffectDenial };
			// 3. Append the accepted candidate id monotonically under the held stream lock.
			const appended = await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, nextCommandSequence: stream.nextCommandSequence }, data: { acceptedCandidateIds: { push: candidate.candidateId } } });
			if (appended.count !== 1) throw new Error("runtime dispatch lost its candidate acceptance fence");
			return { accepted: true };
		});
	}
	catch (error)
	{
		if (error instanceof RuntimeCandidateSideEffectDeniedError) return { accepted: false, reason: error.reason };
		throw error;
	}
}

/** Bind one generic runtime proposal to locked run, conversation, participant, and server time. */
async function _OpenRuntimeElicitation(context: RuntimeDispatchContext, candidate: RuntimeElicitationCandidate, elicitationUnitOfWork: RuntimeElicitationUnitOfWork, now: Date): Promise<boolean>
{
	if (context.identity.kind !== RunInputSnapshotIdentityKinds.User || context.conversationId === null) return false;
	if (candidate.proposal.purpose !== ElicitationPurposes.RuntimeInput && candidate.proposal.purpose !== ElicitationPurposes.A2uiAction) return false;
	const purposePayload = candidate.proposal.purposePayload;
	const expectedPayloadDigest = __DigestCanonicalJson(purposePayload === undefined ? null : purposePayload);
	if (candidate.proposal.purposePayloadDigest !== expectedPayloadDigest) return false;
	const expiresAt = new Date(Math.min(now.getTime() + candidate.proposal.expiresInSeconds * 1_000, context.leaseExpiresAtEpochMs));
	if (expiresAt.getTime() <= now.getTime()) return false;
	const fingerprint = __DigestCanonicalJson({ protocolVersion: candidate.protocolVersion, runtimeInstanceId: candidate.runtimeInstanceId, commandId: candidate.commandId, candidateId: candidate.candidateId, runId: context.runId, attempt: context.attempt, fence: candidate.fence, proposal: candidate.proposal } as unknown as JsonValue);
	const opened = await elicitationUnitOfWork.open({
		requestId: `elicitation-${fingerprint.slice("sha256:".length)}`,
		siloId: context.siloId,
		conversationId: context.conversationId,
		runId: context.runId,
		attempt: context.attempt,
		assignedParticipantId: context.identity.executionSubjectId,
		requestKey: candidate.proposal.requestKey,
		purpose: candidate.proposal.purpose,
		body: candidate.proposal.body,
		purposePayload,
		purposePayloadDigest: expectedPayloadDigest,
		requiresStepUp: false,
		now,
		expiresAt,
	});
	return opened !== null;
}

/** Check the candidate and build the ToolInvocation record saved when it is admitted. Contacts no provider. */
async function _toolInvocationIntent(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, runtimeInstanceId: string, candidate: RuntimeExternalActionCandidate, compileRunInput: RunInputCompiler): Promise<ToolInvocationIntent | null>
{
	try
	{
		const actualArgumentsDigest = __DigestCanonicalJson(candidate.arguments);
		if (actualArgumentsDigest !== candidate.argumentsDigest) return null;
		const compiled = await _CompileRunInputForContext(context, transaction, compileRunInput);
		const tool = compiled.tools.find(function _Granted(definition) { return definition.toolRevisionId === candidate.toolRevisionId; });
		if (tool === undefined || __DigestCanonicalJson(tool.parametersSchema) !== tool.parametersSchemaDigest || !__ValidateDeferredToolArguments(tool.parametersSchema, candidate.arguments)) return null;
		return {
			siloId: context.siloId,
			runId: context.runId,
			attempt: context.attempt,
			agentServiceId: context.agentServiceId,
			agentRevisionId: context.agentRevisionId,
			subjectId: context.identity.executionSubjectId,
			requestIdentity: { runtimeInstanceId, commandId: candidate.commandId, candidateId: candidate.candidateId },
			toolRevisionId: candidate.toolRevisionId,
			toolInvocationId: candidate.toolInvocationId,
			arguments: candidate.arguments,
			argumentsDigest: candidate.argumentsDigest,
			requestFingerprint: _ToolInvocationFingerprint(candidate, actualArgumentsDigest),
			approvalRequired: tool.requiresApproval || candidate.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION,
			recoveryMode: ExternalActionRecoveryModes.Manual,
			recoveryKey: null,
		};
	}
	catch
	{
		return null;
	}
}

/** Hash the invocation together with its canonical arguments, so a replay must carry the same arguments. */
function _ToolInvocationFingerprint(candidate: RuntimeExternalActionCandidate, argumentsDigest: string): string
{
	const canonical = JSON.stringify(["opencrane-tool-invocation-fingerprint-v1", candidate.runId, candidate.attempt, candidate.toolRevisionId, candidate.toolInvocationId, argumentsDigest]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Return whether the assignment's namespace, token audience, and ServiceAccount name match the snapshot identity's kind. */
function _RuntimePlaneMatches(identity: RuntimeAssignmentIdentity, assignment: { namespace: string; audience: string; serviceAccountName: string }, config: RuntimeDispatchAuthorityConfig): boolean
{
	if (identity.kind === RunInputSnapshotIdentityKinds.Service)
	{
		return assignment.namespace === config.managedRuntimeNamespace
			&& assignment.audience === MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE
			&& ___IsManagedAgentRuntimeServiceAccountName(assignment.serviceAccountName);
	}
	return assignment.namespace === config.personalRuntimeNamespace
		&& assignment.audience === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE
		&& ___IsAgentRuntimeServiceAccountName(assignment.serviceAccountName);
}

/** Unbind the runtime instance from its stream if the closing connection still owns it. */
async function _releaseStream(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
{
	await prisma.$transaction(async function _release(transaction: Prisma.TransactionClient): Promise<void>
	{
		const context = await _loadContext(transaction, config, identity);
		if (context === null) return;
		await transaction.runtimeCommandStream.updateMany({ where: { runId: context.runId, attempt: context.attempt, runtimeInstanceId: open.runtimeInstanceId }, data: { runtimeInstanceId: null } });
	});
}

/** Load and lock the assignment, run, and snapshot for this namespace and Pod UID. */
async function _loadContext(transaction: Prisma.TransactionClient, config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity): Promise<RuntimeDispatchContext | null>
{
	// 1. Find the run id first, without locking the assignment. Everything that ends or cancels a run
	// locks the run before the assignment, so keeping that order stops a runtime report from
	// deadlocking with a cancel.
	const discovered = await transaction.workloadAssignment.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
	if (discovered === null) return null;
	// Cancellation and terminal reports also take the advisory lock before the row locks. Taking them
	// in this order lets only one writer work on a run without deadlocking. The text cast lets Prisma
	// deserialize PostgreSQL's void lock result from this raw query.
	await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${discovered.runId}, 0))::text AS "lock"`);
	await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${discovered.runId} FOR UPDATE`);
	await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "namespace" = ${identity.namespace} AND "pod_uid" = ${identity.podUid} FOR UPDATE`);
	const assignment = await transaction.workloadAssignment.findUnique({ where: { namespace_podUid: { namespace: identity.namespace, podUid: identity.podUid } } });
	if (assignment === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered || assignment.serviceAccountName !== identity.serviceAccountName) return null;

	// 2. Reload the owning run and its immutable snapshot under the assignment lock.
	const run = await transaction.agentRun.findUnique({ where: { id: assignment.runId } });
	if (run === null || run.attempt !== assignment.attempt || run.agentServiceId !== assignment.agentServiceId || run.agentRevisionId !== assignment.agentRevisionId || run.siloId !== assignment.siloId) return null;
	const snapshot = await transaction.runInputSnapshot.findUnique({ where: { runId_digest: { runId: run.id, digest: run.inputSnapshotDigest } } });
	if (snapshot === null) return null;
	const snapshotIdentity = _snapshotIdentity(snapshot.identitySnapshot);
	if (snapshotIdentity === null || assignment.subjectId !== snapshotIdentity.executionSubjectId || !_RuntimePlaneMatches(snapshotIdentity, assignment, config)) return null;

	// 3. Compute the canonical assignment digest and return the immutable dispatch context.
	const assignmentDigest = _computeAssignmentDigest({ runId: assignment.runId, attempt: assignment.attempt, agentServiceId: assignment.agentServiceId, agentRevisionId: assignment.agentRevisionId, siloId: assignment.siloId, subjectId: assignment.subjectId, identity: snapshotIdentity, serviceAccountName: assignment.serviceAccountName, podUid: assignment.podUid, expiresAt: assignment.expiresAt, createdAt: assignment.createdAt });
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
			snapshot: __ProjectRuntimeInputSnapshot(snapshot),
			conversationId: snapshot.conversationId,
		personaRevisionId: snapshot.personaRevisionId,
		identity: snapshotIdentity,
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

/** Build the `RuntimeAttemptAuthority` value that `__AdmitRuntimeCommand` and `__AdmitRuntimeCandidate` check against. */
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

/** Build the assignment block that every command carries. */
function _buildAssignmentFrame(context: RuntimeDispatchContext): RuntimeAssignment
{
	return {
		runId: context.runId,
		attempt: context.attempt,
		agentServiceId: context.agentServiceId,
		agentRevisionId: context.agentRevisionId,
		personaRevisionId: context.personaRevisionId ?? undefined,
		siloId: context.siloId,
		identity: context.identity,
		capabilitySetDigest: context.capabilitySetDigest,
		serviceAccountName: context.serviceAccountName,
		podUid: context.podUid,
		assignmentDigest: context.assignmentDigest,
		issuedAt: context.assignmentIssuedAt,
		expiresAt: context.assignmentExpiresAt,
	};
}

/** Extra data for one command body, built only from data that cannot change so it always comes out the same. */
interface CommandExtras
{
	/** The compiled input a `start_attempt` command needs. */
	readonly compiledInput: CompiledRunInput | null;
	/** The approved tool results a `resume_attempt` command needs. */
	readonly resume: ResumeAttemptCommand | null;
	/** Tool-result rows this resume command marks consumed once it is saved. */
	readonly resumeToolResultDeliveryIds: readonly string[];
	/** Elicitation-result rows this resume frame consumes when minted. */
	readonly resumeElicitationResultDeliveryIds: readonly string[];
	/** Steering rows consumed only after their enclosing resume command is persisted. */
	readonly resumeSteeringRequestIds: readonly string[];
	/** Server-defined stop reason carried by a `cancel_attempt` frame. */
	readonly cancelReason: CancelAttemptCommand["reason"];
}
/** Rebuild a stored command's exact envelope for idempotent redelivery on reconnect. */
function _rebuildEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, row: DispatchedCommandRow, extras: CommandExtras): RuntimeCommandEnvelope
{
	const command = _commandBody(context, row.kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: row.commandId, sequence: row.sequence, fence: row.fence, issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/** Build a new command that expires no later than the assignment lease, or null when it would already be expired. */
function _mintEnvelope(context: RuntimeDispatchContext, runtimeInstanceId: string, fence: number, sequence: number, kind: RuntimeCommandKind, nowEpochMs: number, commandTtlMilliseconds: number, extras: CommandExtras): RuntimeCommandEnvelope | null
{
	// 1. Cap the command's expiry at the assignment lease, so a command never outlives the assignment that allows it.
	const expiresAtEpochMs = Math.min(nowEpochMs + commandTtlMilliseconds, context.leaseExpiresAtEpochMs);
	if (nowEpochMs >= expiresAtEpochMs) return null;

	// 2. Build the command. __AdmitRuntimeCommand still checks its fence, its sequence order, and its fields.
	const command = _commandBody(context, kind, extras);
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_V1, runtimeInstanceId, commandId: _commandId(context, sequence), sequence, fence, issuedAt: new Date(nowEpochMs).toISOString(), expiresAt: new Date(expiresAtEpochMs).toISOString(), assignment: _buildAssignmentFrame(context), ...command };
}

/**
 * Build the part of the command that depends on its kind.
 *
 * `start_attempt` carries the immutable snapshot and the input the server compiled from it;
 * `resume_attempt` carries the current input generation and the tool results the server approved,
 * which let a paused attempt continue; `cancel_attempt` carries only a stop reason chosen by the
 * server. Every field is rebuilt from saved data that cannot change, so a re-sent command is
 * byte-for-byte the same as the first one.
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

/** Collect the body data for a new command from saved data that cannot change. */
async function _mintCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, kind: RuntimeCommandKind, inputGeneration: number, compileRunInput: RunInputCompiler): Promise<CommandExtras | null>
{
	if (kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await _CompileRunInputForContext(context, transaction, compileRunInput);
		return { compiledInput, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
	}
	if (kind === RuntimeCommandKind.CancelAttempt) return { compiledInput: null, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: _cancelReason(context.terminalReason) };
	const resumeInputUnitOfWork = new PrismaRuntimeResumeInputUnitOfWork(transaction);
	const loaded = await resumeInputUnitOfWork.load(context.runId, context.attempt, inputGeneration);
	if (loaded === null) return null;
	return { compiledInput: null, resume: loaded.resume, resumeToolResultDeliveryIds: loaded.toolResultDeliveryIds, resumeElicitationResultDeliveryIds: loaded.elicitationResultDeliveryIds, resumeSteeringRequestIds: loaded.steeringRequestIds, cancelReason: "cancelled" };
}
/** Rebuild the body data for a stored command on redelivery, reading a resume payload from its row. */
async function _storedCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, row: DispatchedCommandRow, compileRunInput: RunInputCompiler): Promise<CommandExtras | null>
{
	if (row.kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await _CompileRunInputForContext(context, transaction, compileRunInput);
		return { compiledInput, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
	}
	if (row.kind === RuntimeCommandKind.CancelAttempt) return { compiledInput: null, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: _cancelReason(context.terminalReason) };
	const resume = _ParseRuntimeResumeInput(row.payload);
	if (resume === null) return null;
	return { compiledInput: null, resume, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
}

/** Map a durable run terminal reason to the server-defined cancellation reason the runtime receives. */
function _cancelReason(terminalReason: AgentRunTerminalReason | null): CancelAttemptCommand["reason"]
{
	if (terminalReason === AgentRunTerminalReason.BudgetExhausted) return "budget_exhausted";
	if (terminalReason === AgentRunTerminalReason.PolicyDenied) return "capability_revoked";
	return "cancelled";
}

/** Derive a deterministic, attempt-scoped command id so retries reuse one idempotency key. */
function _commandId(context: RuntimeDispatchContext, sequence: number): string
{
	const canonical = JSON.stringify(["opencrane-runtime-command-id-v1", context.runId, context.attempt, sequence, context.assignmentDigest]);
	return `command-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Maps a Prisma run-state enum member to the lowercase run state used in admission checks. */
function _toAdmissionRunState(state: PrismaAgentRunState): RuntimeAdmissionRunState
{
	switch (state)
	{
		case PrismaAgentRunState.Accepted: return "accepted";
		case PrismaAgentRunState.Queued: return "queued";
		case PrismaAgentRunState.Assigned: return "assigned";
		case PrismaAgentRunState.Running: return "running";
		case PrismaAgentRunState.WaitingForInput: return "waiting_for_input";
		case PrismaAgentRunState.Cancelling: return "cancelling";
		case PrismaAgentRunState.Completed: return "completed";
		case PrismaAgentRunState.Failed: return "failed";
		default: return "cancelled";
	}
}

/** Hash the assignment's identity fields, so a command cannot quietly point at a different run. */
function _computeAssignmentDigest(context: { runId: string; attempt: number; agentServiceId: string; agentRevisionId: string; siloId: string; subjectId: string; identity: RuntimeAssignmentIdentity; serviceAccountName: string; podUid: string; expiresAt: Date; createdAt: Date }): string
{
	const canonical = JSON.stringify(["opencrane-runtime-assignment-digest-v2", context.runId, context.attempt, context.agentServiceId, context.agentRevisionId, context.siloId, context.subjectId, _CanonicalAssignmentIdentity(context.identity), context.serviceAccountName, context.podUid, context.expiresAt.toISOString(), context.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Put the identity fields in a fixed order and shape before they go into the assignment digest. */
function _CanonicalAssignmentIdentity(identity: RuntimeAssignmentIdentity): readonly string[]
{
	if (identity.kind === RunInputSnapshotIdentityKinds.User) return [identity.kind, identity.executionSubjectId, String(identity.fleetMembershipRevision)];
	return [identity.kind, identity.executionSubjectId, identity.agentServiceId, String(identity.fleetMembershipRevision), identity.effectiveBoundaryAttachmentDigest];
}

/** Read the execution identity out of the snapshot's JSON, returning null when it is malformed. */
function _snapshotIdentity(value: unknown): RuntimeAssignmentIdentity | null
{
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const identity = value as Record<string, unknown>;
	const kind = identity["kind"];
	const executionSubjectId = identity["executionSubjectId"];
	const fleetMembershipRevision = identity["fleetMembershipRevision"];
	if ((kind !== "user" && kind !== "service") || typeof executionSubjectId !== "string" || executionSubjectId.trim().length === 0 || typeof fleetMembershipRevision !== "number" || !Number.isSafeInteger(fleetMembershipRevision) || fleetMembershipRevision < 0) return null;
	if (kind === "user") return { kind, executionSubjectId, fleetMembershipRevision };
	const agentServiceId = identity["agentServiceId"];
	const effectiveBoundaryAttachmentDigest = identity["effectiveBoundaryAttachmentDigest"];
	if (typeof agentServiceId !== "string" || agentServiceId.trim().length === 0 || executionSubjectId !== `agent-service:${agentServiceId}` || typeof effectiveBoundaryAttachmentDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(effectiveBoundaryAttachmentDigest)) return null;
	return { kind, executionSubjectId, agentServiceId, fleetMembershipRevision, effectiveBoundaryAttachmentDigest };
}
