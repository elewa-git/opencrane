import { AgentRunState as PrismaAgentRunState, Prisma, RuntimeCommandKind, RuntimeSteeringRequestState, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";

import type { RuntimeCommandStreamAuthority } from "@opencrane/backend/server/infra/agent-runtime-stream";
import { AGENT_RUNTIME_COMMAND_MAX_BYTES, AGENT_RUNTIME_CONTINUATION_MAX_BYTES, RuntimeCandidateKinds, RuntimeCommandKinds, type RuntimeCandidate, type RuntimeCommandEnvelope, type RuntimeContinuationSaveRequest, type RuntimeStreamOpen } from "@opencrane/contracts";
import { ___DoWithTrace, ___GetActiveSpan } from "@opencrane/backend/observability";
import { TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationAdmissionOutcomes, ToolInvocationRunRecoveryEnterResults, __AdmitPreparingToolInvocationInTransaction, __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { RunEventTypes } from "@opencrane/models/agents";

import { _CompileRunInputForContext } from "./compiled-run-input-context";
import { _BuildRuntimeAttemptAuthority, _MintRuntimeCommandEnvelope, _RebuildRuntimeCommandEnvelope, _RuntimeCancelReason } from "./runtime-command-envelope";
import type { RuntimeCommandExtras } from "./runtime-command-envelope.types";
import { _IsConfiguredRuntimeNamespace, _RuntimeDispatchConfigIsValid } from "./runtime-dispatch-config";
import { _ApplyRuntimeCandidateSideEffects, _RuntimeCandidateRequiresEventReporter, RuntimeCandidateSideEffectDeniedError } from "./prisma-runtime-candidate-side-effects";
import { PrismaRuntimeCommandDecisionUnitOfWork } from "./prisma-runtime-command-decision-unit-of-work";
import { PrismaRuntimeDispatchStateUnitOfWork } from "./prisma-runtime-dispatch-state-repository";
import { PrismaRuntimeResumeInputUnitOfWork } from "./prisma-runtime-resume-input-repository";
import { _BindToolInvocationAuthorization, _OpenRuntimeElicitation, _PrepareToolInvocation, _RuntimeToolInvocationFingerprint } from "./runtime-candidate-preparation";
import { __ProjectRuntimeInputSnapshot } from "./runtime-input-snapshot-projector";
import { _ParseRuntimeResumeInput } from "./runtime-resume-input";
import type { RuntimeContinuationAuthority, RuntimeContinuationSaveResult } from "./runtime-continuation.types";
import { __AdmitRuntimeCandidate, __AdmitRuntimeCommand } from "./runtime-protocol-authority";
import { RuntimeAdmissionOutcomes, type RuntimeAdmissionRunState, type RuntimeProtocolClock } from "./runtime-protocol-authority.types";
import { PrismaRuntimeDispatchRepository } from "./prisma-runtime-dispatch-repository";
import type { DispatchedCommandRow, RunInputCompiler, RuntimeApprovalExpiry, RuntimeCandidateDispatchResult, RuntimeDispatchAuthorityConfig, RuntimeDispatchContext, RuntimeDispatchRecoveryAuthority, RuntimeElicitationUnitOfWorkFactory, RuntimeEventReporter, RuntimeExternalActionAuthorization, RuntimeStreamWorkloadIdentity } from "./prisma-runtime-dispatch-authority.types";

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
export class PrismaRuntimeDispatchAuthorityUnitOfWork implements RuntimeCommandStreamAuthority
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
	/** Encrypted continuation authority required by every protocol-v2 resume. */
	private readonly continuationAuthority: RuntimeContinuationAuthority;
	/** Runs-owned transition used when dispatch cannot build a safe frame. */
	private readonly recoveryAuthority: RuntimeDispatchRecoveryAuthority;
	/** Current central product-authority check required before external-effect admission. */
	private readonly externalActionAuthorization: RuntimeExternalActionAuthorization;

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
	 * @param continuationAuthority - Saves and restores the encrypted model-loop continuation.
	 * @param recoveryAuthority - Moves a run into its runs-owned visible recovery state when dispatch
	 * cannot build a safe command frame.
	 * @param externalActionAuthorization - Rechecks current typed product grants on the dispatch transaction.
	 * @throws {Error} When `config` does not hold two different valid namespaces and a command
	 * lifetime between 1s and 300s. Thrown at construction, so a misconfigured deployment fails at
	 * startup instead of mid-stream.
	 */
	constructor(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, compileRunInput: RunInputCompiler, eventReporter: RuntimeEventReporter | undefined, clock: RuntimeProtocolClock | undefined, approvalExpiry: RuntimeApprovalExpiry | undefined, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, continuationAuthority: RuntimeContinuationAuthority, recoveryAuthority: RuntimeDispatchRecoveryAuthority, externalActionAuthorization: RuntimeExternalActionAuthorization)
	{
		if (!_RuntimeDispatchConfigIsValid(config))
			throw new Error("runtime dispatch authority requires distinct bounded runtime namespaces and command lifetime");
		this.prisma = prisma;
		this.config = config;
		this.compileRunInput = compileRunInput;
		this.clock = clock ?? { nowEpochMs(): number { return Date.now(); } };
		this.eventReporter = eventReporter ?? null;
		this.approvalExpiry = approvalExpiry ?? null;
		this.elicitationUnitOfWorkFactory = elicitationUnitOfWorkFactory;
		this.continuationAuthority = continuationAuthority;
		this.recoveryAuthority = recoveryAuthority;
		this.externalActionAuthorization = externalActionAuthorization;
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
		const unitOfWork = this;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		const approvalExpiry = this.approvalExpiry;
		const elicitationUnitOfWorkFactory = this.elicitationUnitOfWorkFactory;
		const recoveryAuthority = this.recoveryAuthority;
		return ___DoWithTrace("runtime_dispatch.command.next", { namespace: identity.namespace }, async function _traceNext(): Promise<RuntimeCommandEnvelope | null>
		{
			const command = await unitOfWork._NextCommand(config, clock, compileRunInput, approvalExpiry, elicitationUnitOfWorkFactory, recoveryAuthority, identity, open, afterSequence);
			return command === null ? null : unitOfWork.continuationAuthority.attachToResume(identity, open, command);
		});
	}

	/** Validate and save one encrypted protocol-v2 continuation. */
	async __SaveContinuation(identity: RuntimeStreamWorkloadIdentity, request: RuntimeContinuationSaveRequest): Promise<RuntimeContinuationSaveResult>
	{
		return this.continuationAuthority.save(identity, request);
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
		const unitOfWork = this;
		const config = this.config;
		const clock = this.clock;
		const compileRunInput = this.compileRunInput;
		const eventReporter = this.eventReporter;
		const elicitationUnitOfWorkFactory = this.elicitationUnitOfWorkFactory;
		const externalActionAuthorization = this.externalActionAuthorization;
		return ___DoWithTrace("runtime_dispatch.candidate.admit", { namespace: identity.namespace }, async function _traceAdmit(): Promise<RuntimeCandidateDispatchResult>
		{
			return unitOfWork._AdmitCandidate(config, clock, compileRunInput, identity, candidate, eventReporter, elicitationUnitOfWorkFactory, externalActionAuthorization);
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
		const unitOfWork = this;
		const config = this.config;
		await ___DoWithTrace("runtime_dispatch.stream.release", { namespace: identity.namespace }, async function _traceRelease(): Promise<void>
		{
			await unitOfWork._ReleaseStream(config, identity, open);
		});
	}

	/** Opens the serializable command-selection transaction. */
	private async _NextCommand(config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, approvalExpiry: RuntimeApprovalExpiry | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, recoveryAuthority: RuntimeDispatchRecoveryAuthority, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
	{
		return this._Run(function _Dispatch(transaction, repository): Promise<RuntimeCommandEnvelope | null>
		{
			return _nextCommand(transaction, repository, config, clock, compileRunInput, approvalExpiry, elicitationUnitOfWorkFactory, recoveryAuthority, identity, open, afterSequence);
		});
	}

	/** Opens the serializable candidate-admission transaction. */
	private async _AdmitCandidate(config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate, eventReporter: RuntimeEventReporter | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, externalActionAuthorization: RuntimeExternalActionAuthorization): Promise<RuntimeCandidateDispatchResult>
	{
		try
		{
			return await this._Run(function _Admit(transaction, repository): Promise<RuntimeCandidateDispatchResult>
			{
				return _admitCandidate(transaction, repository, config, clock, compileRunInput, identity, candidate, eventReporter, elicitationUnitOfWorkFactory, externalActionAuthorization);
			});
		}
		catch (error)
		{
			if (error instanceof RuntimeCandidateSideEffectDeniedError)
				return { accepted: false, reason: error.reason };
			throw error;
		}
	}

	/** Opens the serializable stream-release transaction. */
	private async _ReleaseStream(config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
	{
		await this._Run(async function _Release(_transaction, repository): Promise<void>
		{
			await _releaseStream(repository, config, identity, open);
		});
	}

	/** Runs one dispatch operation in a serializable transaction. */
	private _Run<TResult>(operation: (transaction: Prisma.TransactionClient, repository: PrismaRuntimeDispatchRepository) => Promise<TResult>): Promise<TResult>
	{
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaRuntimeDispatchRepository(transaction);
			return operation(transaction, repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Create a new command, or re-send a stored one, inside one Serializable transaction. */
async function _nextCommand(transaction: Prisma.TransactionClient, repository: PrismaRuntimeDispatchRepository, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, approvalExpiry: RuntimeApprovalExpiry | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, recoveryAuthority: RuntimeDispatchRecoveryAuthority, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen, afterSequence: number): Promise<RuntimeCommandEnvelope | null>
{
	if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) return null;
		const elicitationUnitOfWork = elicitationUnitOfWorkFactory.bind(transaction);
		// 1. Load the live assignment, run, and snapshot before any authority decision.
		let context = await repository.loadContext(config, identity);
		if (context === null) return null;
		// An attempt waiting for approval cannot move on until overdue approvals are closed. That runs
		// in this same transaction, and then the context is read again, so
		// the next command is chosen from what the database says now, not from the values read earlier.
		const decisionUnitOfWork = new PrismaRuntimeCommandDecisionUnitOfWork(transaction);
		const expiry = await decisionUnitOfWork.expireWaiting(context, approvalExpiry, elicitationUnitOfWork, new Date(clock.nowEpochMs()));
		if (expiry === "unavailable") return null;
		if (expiry === "applied")
		{
			context = await repository.loadContext(config, identity);
			if (context === null) return null;
		}
		if (context.runState === "waiting_for_input")
		{
			const waitReasons = await decisionUnitOfWork.readWaitReasons(context);
			___GetActiveSpan()?.setAttribute("wait.reasons", [...waitReasons]);
			___GetActiveSpan()?.setAttribute("wait.reason_count", waitReasons.length);
		}

		// 2. Bind the stream to the connecting runtime instance so a stale instance cannot be served.
		const runtimeInstanceId = await repository.bind(context, open.runtimeInstanceId);
		if (runtimeInstanceId === null) return null;
		const stream = await repository.readStream(context.runId, context.attempt);
		if (stream === null) return null;
		const commands = await repository.readCommands(context.runId, context.attempt);
		const authority = _BuildRuntimeAttemptAuthority(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);

		// 3. Redeliver a stored command the transport has not yet re-sent on this connection.
		const firstCurrentFenceCommand = commands.find(function _CurrentFence(row) { return row.fence === stream.fence; });
		const targetSequence = afterSequence === 0 && commands.some(function _HistoricalFence(row) { return row.fence < stream.fence; })
			? firstCurrentFenceCommand?.sequence ?? stream.nextCommandSequence
			: afterSequence + 1;
		// A cancel replaces older work: while cancelling, send the saved cancel command, which is the one row with a sequence higher than what the runtime has already seen.
		const stored = context.runState === "cancelling" ? commands.find(function _UnobservedCancel(row) { return row.kind === RuntimeCommandKind.CancelAttempt && row.fence === stream.fence && row.sequence >= targetSequence; }) : commands.find(function _AtTarget(row) { return row.fence === stream.fence && row.sequence === targetSequence; });
		if (stored)
		{
			// Rebuild the body from data that cannot change (or from the saved resume payload), so a
			// re-sent command is byte-for-byte the same even after its tool-result rows were consumed.
			const extras = await _storedCommandExtras(transaction, context, stored, compileRunInput);
			if (extras === null) return null;
			const envelope = _RebuildRuntimeCommandEnvelope(context, runtimeInstanceId, stored, extras);
			const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
			if (admission.outcome !== RuntimeAdmissionOutcomes.Idempotent)
				return null;
			if (!_LeavesContinuationHeadroom(envelope))
			{
				await _MarkDispatchRecoveryRequired(transaction, repository, recoveryAuthority, context.runId, context.attempt, stream.nextCommandSequence, new Date(clock.nowEpochMs()));
				return null;
			}
			return envelope;
		}
		if (context.runState !== "cancelling" && targetSequence !== stream.nextCommandSequence) return null;

		// 4. Decide whether a new command is due, build it, and check it before saving it.
		const kind = await decisionUnitOfWork.decide(context, commands);
		if (kind === null) return null;
		const nowEpochMs = clock.nowEpochMs();
		const extras = await _mintCommandExtras(transaction, context, kind, stream.inputGeneration, compileRunInput);
		if (extras === null) return null;
		const envelope = _MintRuntimeCommandEnvelope(context, runtimeInstanceId, stream.fence, stream.nextCommandSequence, kind, nowEpochMs, config.commandTtlMilliseconds, extras);
		if (envelope === null) return null;
		const admission = __AdmitRuntimeCommand({ authority, command: envelope, clock });
		if (admission.outcome !== RuntimeAdmissionOutcomes.Accepted) return null;
		if (!_LeavesContinuationHeadroom(envelope))
		{
			await _MarkDispatchRecoveryRequired(transaction, repository, recoveryAuthority, context.runId, context.attempt, stream.nextCommandSequence, new Date(nowEpochMs));
			return null;
		}
		// 5. Persist the accepted command (with any resume payload) and advance its exact sequence fence.
		await repository.saveCommand({ runId: context.runId, attempt: context.attempt, sequence: envelope.sequence, commandId: envelope.commandId, kind, fence: envelope.fence, payload: extras.resume === null ? Prisma.DbNull : extras.resume as unknown as Prisma.InputJsonValue, issuedAt: new Date(envelope.issuedAt), expiresAt: new Date(envelope.expiresAt) });
		const advanced = await repository.advanceCommand(context.runId, context.attempt, stream.nextCommandSequence, admission.nextCommandSequence);
		if (advanced.count !== 1) throw new Error("runtime dispatch lost its command sequence fence");
		// Mark the tool-result rows consumed only after the command that carries them is saved.
		const stateUnitOfWork = kind === RuntimeCommandKind.ResumeAttempt ? new PrismaRuntimeDispatchStateUnitOfWork(transaction) : null;
		if (stateUnitOfWork !== null && extras.resumeToolResultDeliveryIds.length > 0)
			await stateUnitOfWork.consumeToolResultDeliveries(extras.resumeToolResultDeliveryIds, new Date(nowEpochMs));
		if (stateUnitOfWork !== null && extras.resumeElicitationResultDeliveryIds.length > 0)
			await stateUnitOfWork.consumeElicitationResultDeliveries(extras.resumeElicitationResultDeliveryIds, new Date(nowEpochMs));
		if (kind === RuntimeCommandKind.ResumeAttempt && extras.resumeSteeringRequestIds.length > 0)
			await repository.consumeSteeringRequests(extras.resumeSteeringRequestIds, new Date(nowEpochMs));
		return envelope;
}

/** Persist one command-stream block and its runs-owned recovery state on the same transaction. */
async function _MarkDispatchRecoveryRequired(transaction: Prisma.TransactionClient, repository: PrismaRuntimeDispatchRepository, recoveryAuthority: RuntimeDispatchRecoveryAuthority, runId: string, attempt: number, expectedSequence: number, now: Date): Promise<void>
{
	const blocked = await repository.markDispatchRecoveryRequired(runId, attempt, expectedSequence, "resume_frame_too_large", now);
	if (blocked.count !== 1)
		throw new Error("runtime dispatch lost its recovery-state fence");
	const recovery = await recoveryAuthority.enterRecoveryRequiredInTransaction(transaction, { runId, attempt });
	if (recovery !== ToolInvocationRunRecoveryEnterResults.Entered && recovery !== ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired)
		throw new Error("runtime dispatch could not expose its recovery state");
}

/** Reserve enough of the 64KiB command frame for the largest admitted continuation. */
function _LeavesContinuationHeadroom(command: RuntimeCommandEnvelope): boolean
{
	if (command.kind !== RuntimeCommandKinds.ResumeAttempt)
		return true;
	const continuationPropertyBytes = Buffer.byteLength(',"continuation":', "utf8");
	const sseDataLineBytes = Buffer.byteLength("data: \n", "utf8");
	return Buffer.byteLength(JSON.stringify(command), "utf8") + continuationPropertyBytes + AGENT_RUNTIME_CONTINUATION_MAX_BYTES + sseDataLineBytes <= AGENT_RUNTIME_COMMAND_MAX_BYTES;
}
/** Admit one runtime candidate and durably record its id when the pure authority accepts it. */
async function _admitCandidate(transaction: Prisma.TransactionClient, repository: PrismaRuntimeDispatchRepository, config: RuntimeDispatchAuthorityConfig, clock: RuntimeProtocolClock, compileRunInput: RunInputCompiler, identity: RuntimeStreamWorkloadIdentity, candidate: RuntimeCandidate, eventReporter: RuntimeEventReporter | null, elicitationUnitOfWorkFactory: RuntimeElicitationUnitOfWorkFactory, externalActionAuthorization: RuntimeExternalActionAuthorization): Promise<RuntimeCandidateDispatchResult>
{
	if (candidate.kind === RuntimeCandidateKinds.Event && candidate.eventType === RunEventTypes.RunCancelled) return { accepted: false, reason: "runtime_cancellation_not_authoritative" };
	if (_RuntimeCandidateRequiresEventReporter(candidate) && eventReporter === null) return { accepted: false, reason: "event_reporter_unavailable" };
			const elicitationUnitOfWork = elicitationUnitOfWorkFactory.bind(transaction);
			// 1. Load the live assignment, run, and snapshot for the Pod that is asking.
			const context = await repository.loadContext(config, identity);
			if (context === null) return { accepted: false, reason: "unknown_workload" };
			const stream = await repository.readStream(context.runId, context.attempt);
			if (stream === null || stream.runtimeInstanceId === null) return { accepted: false, reason: "no_active_stream" };
			const commands = await repository.readCommands(context.runId, context.attempt);
			const authority = _BuildRuntimeAttemptAuthority(context, stream.runtimeInstanceId, stream.fence, stream.nextCommandSequence, commands, stream.acceptedCandidateIds);
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
				const requestFingerprint = _RuntimeToolInvocationFingerprint(candidate, actualArgumentsDigest);
				return invocation !== null && actualArgumentsDigest === candidate.argumentsDigest && invocation.runtimeInstanceId === candidate.runtimeInstanceId && invocation.commandId === candidate.commandId && invocation.toolRevisionId === candidate.toolRevisionId && invocation.toolInvocationId === candidate.toolInvocationId && invocation.argumentsDigest === actualArgumentsDigest && invocation.requestFingerprint === requestFingerprint ? { accepted: true } : { accepted: false, reason: "external_action_replay_conflict" };
			}
			if (admission.outcome === RuntimeAdmissionOutcomes.Denied) return { accepted: false, reason: admission.reason };
			const sourceCommand = commands.find(function _MatchesCandidate(row) { return row.commandId === candidate.commandId; });
			if (sourceCommand === undefined) return { accepted: false, reason: "command_not_accepted" };
			// 2b. Persist complete provider-free work authority before accepting an external action.
			if (candidate.kind === RuntimeCandidateKinds.ExternalAction)
			{
				const now = new Date(clock.nowEpochMs());
				const preparation = await _PrepareToolInvocation(transaction, context, stream.runtimeInstanceId, candidate, compileRunInput);
				if (preparation === null)
					return { accepted: false, reason: "external_action_invalid" };
				const authorizationEvidence = await externalActionAuthorization.admitInTransaction(transaction, context, candidate, now);
				if (authorizationEvidence === null)
					return { accepted: false, reason: "external_action_not_authorized" };
				const intent = _BindToolInvocationAuthorization(preparation, context, authorizationEvidence);
				if (intent === null)
					throw new RuntimeCandidateSideEffectDeniedError("external_action_invalid");
				const durable = await __AdmitPreparingToolInvocationInTransaction(transaction, intent, now, TOOL_INVOCATION_PREPARATION_POLICY);
				if (durable.outcome === ToolInvocationAdmissionOutcomes.Conflict)
					throw new RuntimeCandidateSideEffectDeniedError("external_action_conflict");
			}
			if (candidate.kind === RuntimeCandidateKinds.Elicitation)
			{
				if (!await _OpenRuntimeElicitation(context, candidate, elicitationUnitOfWork, new Date(clock.nowEpochMs()))) return { accepted: false, reason: "elicitation_invalid" };
			}
			// 2c. Apply transaction-local canonical event effects before accepting the id.
			const sideEffectDenial = await _ApplyRuntimeCandidateSideEffects(transaction, candidate, context.runId, context.attempt, sourceCommand.kind === RuntimeCommandKind.StartAttempt, eventReporter);
			if (sideEffectDenial !== null)
				throw new RuntimeCandidateSideEffectDeniedError(sideEffectDenial);
			// 3. Append the accepted candidate id monotonically under the exact stream sequence fence.
			const appended = await repository.appendCandidate(context.runId, context.attempt, stream.nextCommandSequence, candidate.candidateId);
			if (appended.count !== 1) throw new Error("runtime dispatch lost its candidate acceptance fence");
			return { accepted: true };
}

/** Unbind the runtime instance from its stream if the closing connection still owns it. */
async function _releaseStream(repository: PrismaRuntimeDispatchRepository, config: RuntimeDispatchAuthorityConfig, identity: RuntimeStreamWorkloadIdentity, open: RuntimeStreamOpen): Promise<void>
{
		const context = await repository.loadContext(config, identity);
		if (context === null) return;
		await repository.release(context.runId, context.attempt, open.runtimeInstanceId);
}

/** Collect the body data for a new command from saved data that cannot change. */
async function _mintCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, kind: RuntimeCommandKind, inputGeneration: number, compileRunInput: RunInputCompiler): Promise<RuntimeCommandExtras | null>
{
	if (kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await _CompileRunInputForContext(context, transaction, compileRunInput);
		return { compiledInput, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
	}
	if (kind === RuntimeCommandKind.CancelAttempt)
		return { compiledInput: null, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: _RuntimeCancelReason(context.terminalReason) };
	const resumeInputUnitOfWork = new PrismaRuntimeResumeInputUnitOfWork(transaction);
	const loaded = await resumeInputUnitOfWork.load(context.runId, context.attempt, inputGeneration);
	if (loaded === null) return null;
	return { compiledInput: null, resume: loaded.resume, resumeToolResultDeliveryIds: loaded.toolResultDeliveryIds, resumeElicitationResultDeliveryIds: loaded.elicitationResultDeliveryIds, resumeSteeringRequestIds: loaded.steeringRequestIds, cancelReason: "cancelled" };
}
/** Rebuild the body data for a stored command on redelivery, reading a resume payload from its row. */
async function _storedCommandExtras(transaction: Prisma.TransactionClient, context: RuntimeDispatchContext, row: DispatchedCommandRow, compileRunInput: RunInputCompiler): Promise<RuntimeCommandExtras | null>
{
	if (row.kind === RuntimeCommandKind.StartAttempt)
	{
		const compiledInput = await _CompileRunInputForContext(context, transaction, compileRunInput);
		return { compiledInput, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
	}
	if (row.kind === RuntimeCommandKind.CancelAttempt)
		return { compiledInput: null, resume: null, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: _RuntimeCancelReason(context.terminalReason) };
	const resume = _ParseRuntimeResumeInput(row.payload);
	if (resume === null) return null;
	return { compiledInput: null, resume, resumeToolResultDeliveryIds: [], resumeElicitationResultDeliveryIds: [], resumeSteeringRequestIds: [], cancelReason: "cancelled" };
}
