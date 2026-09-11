import { _AdvanceConversationComputerModel, _ConversationModelReservationStatus } from "./conversation-computer-model-flow";
import { _ConversationFailureDiagnostic } from "../../messages/conversation-failure-diagnostic";
import type { ConversationComputerModelProgress } from "./conversation-computer-model.types";
import { __AssertConversationComputerAnswerAuthority } from "./conversation-computer-answer-authority";
import { createHash } from "node:crypto";
import { ConversationEntryKinds, ConversationMessageContentBlockKinds, type CompiledRunInput } from "@opencrane/contracts";

import type { ConversationComputerOutputCommand, ConversationComputerPodLeaseCommand, ConversationComputerReviewCredentialGrant, ConversationComputerRunLifecycleCommand, ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityPort, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, ConversationComputerTurnWorkflowCommand, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import { ConversationComputerOutputPositionConflictError } from "./conversation-computer-turn-store";

/** Coordinates one durable, lease-fenced conversation turn for a bound sandbox Pod. */
export class ConversationComputerTurnAuthority implements ConversationComputerTurnAuthorityPort
{
	public constructor(private readonly dependencies: ConversationComputerTurnAuthorityDependencies) {}

	/**
	 * Hand the review gateway secret to the Pod that proved it holds the current lease.
	 *
	 * The Pod calls this once at start, before checkpoint restore, so the server can already reach its
	 * review surface when it streams the workspace back. The value is derived, not stored, so a retry
	 * returns the same secret and a new lease invalidates it.
	 */
	public async reviewCredential(command: ConversationComputerPodLeaseCommand): Promise<ConversationComputerReviewCredentialGrant>
	{
		await this.dependencies.candidates.admit(command);
		return { reviewCredential: this.dependencies.reviewCredentials.derive({ siloId: this.dependencies.siloId, computerId: command.computerId, lease: command.lease }) };
	}

	/**
	 * Freeze the next pending turn or recover its saved model status without revealing credentials.
	 *
	 * Saved output is recovered before recompilation because its own history append may already have
	 * changed the conversation head. An unreserved turn must still reproduce the frozen input digest.
	 * A reserved request reports status without creating another allowance or handing a key to the Pod.
	 * Saved tool content may report ready so the server can continue admission and result handling;
	 * that status never permits the first model request to dispatch again.
	 */
	public async start(command: ConversationComputerTurnWorkflowCommand): Promise<FrozenConversationComputerTurn | null>
	{
		const active = await this.dependencies.store.loadActive({ siloId: this.dependencies.siloId, computerId: command.computerId, lease: command.lease });
		if (active !== null && active.outputReceipt !== null)
		{
			await this._FinishOutput(active);
			return this.start(command);
		}
		if (active !== null)
		{
			const execution = await this.dependencies.candidates.assertCurrentForWorkflow(active);
			_AssertRecompiledInput(active, execution.candidate.compiledInput);
			await this.dependencies.runLifecycle.start(_RunLifecycleCommand(active));
			return active;
		}
		const execution = await this.dependencies.candidates.resolveForWorkflow(command);
		if (execution === null)
			return null;
		const candidate = execution.candidate;
		const bootstrapId = _Uuid("bootstrap", [candidate.binding.siloId, command.computerId, String(command.lease.leaseGeneration), command.lease.leaseId, candidate.latestPendingEntryId]);
		const proposed = _Freeze(candidate, command, bootstrapId);
		const turn = active ?? await this.dependencies.store.createOrRead(proposed);
		_AssertSameTurn(proposed, turn);
		_AssertRecompiledInput(turn, candidate.compiledInput);
		const current = await this.dependencies.candidates.assertCurrentForWorkflow(turn);
		_AssertRecompiledInput(turn, current.candidate.compiledInput);
		if (turn.outputSourceCommandId !== null)
			return null;
		await this.dependencies.runLifecycle.start(_RunLifecycleCommand(turn));
		return turn;
	}

	/** Advance saved model and tool evidence; failures never create another paid allowance. */
	public async advance(turnId: string): Promise<ConversationComputerModelProgress>
	{
		const turn = await this.dependencies.store.load(turnId);
		if (turn === null)
			return { outcome: "authority_ended" };
		if (turn.outputReceipt !== null)
		{
			await this._FinishOutput(turn);
			return { outcome: "completed" };
		}
		await this.dependencies.candidates.assertCurrentForWorkflow(turn);
		try
		{
			return await _AdvanceConversationComputerModel(turn, this.dependencies, this.appendOutput.bind(this));
		}
		catch (error)
		{
			this.dependencies.logger.warn({ operation: "conversation.computer.workflow.advance", err: _ConversationFailureDiagnostic(error) }, "Conversation workflow has no completed answer receipt");
			const saved = await this.dependencies.store.load(turn.bootstrapId);
			if (saved?.continuationReservation !== null && saved !== null)
				return _ConversationModelReservationStatus(saved.continuationReservation);
			if (saved?.toolSelection !== null && saved !== null)
				return { outcome: "retry" };
			return saved?.modelReservation !== null && saved !== null ? _ConversationModelReservationStatus(saved.modelReservation) : { outcome: "retry" };
		}
	}

	/** Save only the winning server model response; the Pod has no output-submission route. */
	public async appendOutput(command: ConversationComputerOutputCommand): Promise<"accepted" | "idempotent">
	{
		const turn = await this.dependencies.store.load(command.bootstrapId);
		if (turn === null)
			throw new Error("Conversation computer output requires an admitted bootstrap");
		const reservation = turn.continuationReservation ?? turn.modelReservation;
		if (turn.toolSelection !== null && turn.continuationReservation === null || reservation === null || reservation.invocationFence !== command.modelInvocationFence || command.sourceCommandId !== command.modelInvocationFence || !Number.isSafeInteger(command.modelNotAfterEpochMs) || command.modelNotAfterEpochMs > reservation.dispatchDeadlineEpochMs)
			throw new Error("Conversation computer output cannot finish unresolved tool work");
		if (turn.outputSourceCommandId !== null)
		{
			if (turn.outputSourceCommandId !== command.sourceCommandId || turn.outputReceipt === null)
				throw new Error("Conversation computer turn already has a different output");
			const payload = await this.dependencies.outputPayloads.store(turn, command.sourceCommandId, command.text);
			const entry = turn.outputReceipt.event.data.entry;
			if (entry.kind !== ConversationEntryKinds.Message || entry.blocks.length !== 1 || entry.blocks[0].kind !== ConversationMessageContentBlockKinds.Text
				|| entry.blocks[0].id !== payload.blockId || entry.blocks[0].payloadRef !== payload.payloadRef || entry.blocks[0].ciphertextDigest !== payload.ciphertextDigest)
				throw new Error("Conversation computer output retry has a different saved payload");
			await this._FinishOutput(turn);
			return "idempotent";
		}
		while (true)
		{
			const execution = await this.dependencies.candidates.assertCurrentForWorkflow(turn);
			const outputTurn = { ...turn, binding: execution.candidate.binding };
			const payload = await this.dependencies.outputPayloads.store(outputTurn, command.sourceCommandId, command.text);
			const authority = await __AssertConversationComputerAnswerAuthority(turn, execution.workload, this.dependencies);
			const notAfter = Math.min(command.modelNotAfterEpochMs, authority.notAfterEpochMs);
			const commitTurn = { ...turn, binding: authority.candidate.binding };
			const writer = this.dependencies.writers.create(commitTurn, execution.workload);
			const receipt = await writer.prepare({ sourceCommandId: command.sourceCommandId, entry: { kind: "message", state: "completed", blocks: [{ id: payload.blockId, kind: "text", payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } });
			const finalExecution = await this.dependencies.candidates.assertCurrentForWorkflow(turn);
			const finalAuthority = await __AssertConversationComputerAnswerAuthority(turn, finalExecution.workload, this.dependencies);
			if (finalAuthority.candidate.binding.expectedRevision !== commitTurn.binding.expectedRevision)
				continue;
			if (Date.now() >= Math.min(reservation.dispatchDeadlineEpochMs, notAfter, finalAuthority.notAfterEpochMs))
				throw new Error("Conversation computer model response missed its fixed dispatch deadline");
			try
			{
				const decision = await this.dependencies.store.markOutput(turn.bootstrapId, receipt);
				await this._FinishOutput({ ...turn, outputSourceCommandId: decision.receipt.event.id, outputReceipt: decision.receipt });
				return decision.outcome;
			}
			catch (error)
			{
				if (!(error instanceof ConversationComputerOutputPositionConflictError))
					throw error;
			}
		}
	}

	/** Confirm the saved event before completing idempotent run, credential and active-pointer work. */
	private async _FinishOutput(turn: FrozenConversationComputerTurn): Promise<void>
	{
		if (turn.outputReceipt === null)
			throw new Error("Conversation computer output receipt is missing");
		const workload = await this.dependencies.candidates.assertLeaseForWorkflow(turn);
		const writer = this.dependencies.writers.create(_TurnAtOutputPosition(turn), workload);
		await writer.confirm(turn.outputReceipt);
		await this.dependencies.runLifecycle.complete(_RunLifecycleCommand(turn));
		await this.dependencies.credentials.revoke(turn.bootstrapId);
		await this.dependencies.store.settle(turn);
	}

}

/** Copies only the immutable attempt and lease fence needed by run lifecycle. */
function _RunLifecycleCommand(turn: FrozenConversationComputerTurn): ConversationComputerRunLifecycleCommand
{
	return { runId: turn.compile.runId, siloId: turn.siloId, attempt: turn.compile.attempt, computerId: turn.computerId, lease: { leaseId: turn.lease.leaseId, leaseGeneration: turn.lease.leaseGeneration } };
}

/** Rebuild the exact append binding selected by the atomically saved output receipt. */
function _TurnAtOutputPosition(turn: FrozenConversationComputerTurn): FrozenConversationComputerTurn
{
	if (turn.outputReceipt === null)
		throw new Error("Conversation computer output receipt is missing");
	const expectedRevision = BigInt(turn.outputReceipt.expectedRevision);
	if (expectedRevision < turn.binding.expectedRevision)
		throw new Error("Conversation computer output position precedes its frozen input");
	return { ...turn, binding: { ...turn.binding, expectedRevision } };
}

/**
 * Build the durable record field by field so compiled content can never ride along into the Kurrent event.
 *
 * The lease is copied from the candidate: the compiler received it from this same workflow command
 * and added the SandboxClaim the Pod-binding check proved.
 */
function _Freeze(candidate: ConversationComputerTurnCandidate, command: ConversationComputerTurnWorkflowCommand, bootstrapId: string): FrozenConversationComputerTurn
{
	const input = candidate.compiledInput;
	return {
		bootstrapId,
		siloId: candidate.binding.siloId,
		computerId: command.computerId,
		lease: { leaseId: candidate.lease.leaseId, leaseGeneration: candidate.lease.leaseGeneration, sandboxClaimId: candidate.lease.sandboxClaimId },
		binding: candidate.binding,
		latestPendingEntryId: candidate.latestPendingEntryId,
		latestPendingEntryPosition: candidate.latestPendingEntryPosition,
		modelAlias: candidate.modelAlias,
		maximumBudgetUsd: candidate.maximumBudgetUsd,
		credentialLifetimeSeconds: candidate.credentialLifetimeSeconds,
		compile: { runId: input.runId, attempt: input.attempt, promptCompilerVersion: input.promptCompilerVersion, digest: input.digest },
		outputSourceCommandId: null,
		outputReceipt: null, cancellationReceipt: null,
		toolSelection: null,
		continuationReservation: null,
		modelReservation: null,
	};
}

/** Reject changed compiled input before server-side model dispatch. */
function _AssertRecompiledInput(turn: FrozenConversationComputerTurn, compiledInput: CompiledRunInput): void
{
	const anchor = turn.compile;
	if (compiledInput.digest !== anchor.digest || compiledInput.runId !== anchor.runId || compiledInput.attempt !== anchor.attempt || compiledInput.promptCompilerVersion !== anchor.promptCompilerVersion)
		throw new Error(`Conversation computer recompiled input ${compiledInput.digest} does not match the frozen turn digest ${anchor.digest}`);
}

/** Derive an RFC-4122 UUID from closed server-owned turn coordinates. */
function _Uuid(domain: string, coordinates: readonly string[]): string
{
	const hex = createHash("sha256").update(JSON.stringify([domain, ...coordinates])).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

/** Reject a conflicting event at the deterministic bootstrap coordinate. */
function _AssertSameTurn(expected: FrozenConversationComputerTurn, actual: FrozenConversationComputerTurn): void
{
	if (actual.bootstrapId !== expected.bootstrapId || actual.siloId !== expected.siloId || actual.computerId !== expected.computerId || actual.lease.leaseGeneration !== expected.lease.leaseGeneration || actual.lease.leaseId !== expected.lease.leaseId || actual.latestPendingEntryId !== expected.latestPendingEntryId || actual.latestPendingEntryPosition !== expected.latestPendingEntryPosition || actual.binding.expectedRevision !== expected.binding.expectedRevision || actual.modelAlias !== expected.modelAlias)
		throw new Error("Conversation computer bootstrap conflicts with its durable turn record");
}
