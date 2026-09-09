import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals, type ConversationToolProposalCommand } from "./conversation-tool-proposal.types";
import { _PrepareConversationToolProposal } from "./conversation-tool-proposal";
import { createHash } from "node:crypto";

import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ___ConversationToolProposalSchema, type ConversationToolProposalReceipt, type CompiledRunInput, type ComputerScope } from "@opencrane/contracts";

import type { ConversationComputerBootstrap, ConversationComputerBootstrapCommand, ConversationComputerOutputCommand, ConversationComputerReviewCredentialGrant, ConversationComputerRunLifecycleCommand, ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityPort, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

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
	public async reviewCredential(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerReviewCredentialGrant>
	{
		await this.dependencies.candidates.admit(command);
		return { reviewCredential: this.dependencies.reviewCredentials.derive({ siloId: this.dependencies.siloId, computerId: command.computerId, lease: command.lease }) };
	}

	/**
	 * Freeze the next pending turn's coordinates, recompile against them, and issue the attempt-scoped model credential.
	 *
	 * First or retried input handoff recompiles the admitted snapshot and requires its frozen digest.
	 * A saved answer instead recovers its exact history event and completes bookkeeping under the
	 * current Pod and lease; that branch returns no model input or credential.
	 */
	public async bootstrap(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerBootstrap | null>
	{
		const active = await this.dependencies.store.loadActive({ siloId: this.dependencies.siloId, computerId: command.computerId, lease: command.lease });
		if (active !== null && active.outputReceipt !== null)
		{
			await this._FinishOutput(active, command.workload);
			return null;
		}
		const candidate = await this.dependencies.candidates.resolve(command);
		if (candidate === null)
			return null;
		const bootstrapId = _Uuid("bootstrap", [candidate.binding.siloId, command.computerId, String(command.lease.leaseGeneration), command.lease.leaseId, candidate.latestPendingEntryId]);
		const proposed = _Freeze(candidate, command, bootstrapId);
		const turn = active ?? await this.dependencies.store.createOrRead(proposed);
		_AssertSameTurn(proposed, turn);
		_AssertRecompiledInput(turn, candidate.compiledInput);
		await this.dependencies.candidates.assertCurrent(turn, command.workload);
		if (turn.outputSourceCommandId !== null || turn.toolReservation !== null)
			return null;
		await this.dependencies.runLifecycle.start(_RunLifecycleCommand(turn));
		const keyAlias = `attempt-${createHash("sha256").update(turn.bootstrapId).digest("hex").slice(0, 40)}`;
		const snapshotBudget = candidate.compiledInput.budget.maxCostUsdMicros;
		const maxBudgetUsd = snapshotBudget === null ? turn.maximumBudgetUsd : Math.min(turn.maximumBudgetUsd, snapshotBudget / 1_000_000);
		const credential = await this.dependencies.credentials.issueOrRotate({ bootstrapId: turn.bootstrapId, computer: _ComputerScope(turn), lease: turn.lease, keyAlias, modelAlias: turn.modelAlias, maxBudgetUsd, expirySeconds: Math.min(turn.credentialLifetimeSeconds, candidate.credentialLifetimeSeconds), notAfter: candidate.credentialExpiresAt });
		return { bootstrapId: turn.bootstrapId, compiledInput: candidate.compiledInput, modelCredential: { endpoint: this.dependencies.endpoint, key: credential.key, model: turn.modelAlias }, outcome: "ready" };
	}

	/** Admit one exact proposal for the current Pod without treating the runtime as effect authority. */
	public async proposeTool(command: ConversationToolProposalCommand): Promise<ConversationToolProposalReceipt>
	{
		const proposal = ___ConversationToolProposalSchema.safeParse({ bootstrapId: command.bootstrapId, toolRevisionId: command.toolRevisionId, arguments: command.arguments });
		if (!proposal.success)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Invalid);
		const turn = await this.dependencies.store.load(command.bootstrapId);
		if (turn === null || turn.outputSourceCommandId !== null || turn.outputReceipt !== null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const candidate = await this.dependencies.candidates.assertCurrent(turn, command.workload);
		const prepared = _PrepareConversationToolProposal(turn, candidate, proposal.data);
		await this.dependencies.store.reserveTool(turn.bootstrapId, { proposalId: prepared.proposalId, requestFingerprint: prepared.requestFingerprint });
		const workload = { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: command.workload.namespace, serviceAccountName: command.workload.serviceAccountName, workloadKind: "pod" as const, workloadUid: command.workload.podUid, podUid: command.workload.podUid };
		return this.dependencies.toolProposals.admit(turn, candidate, { ...proposal.data, arguments: prepared.arguments }, workload);
	}

	/** Save an encrypted payload and a complete output intent before participant history can change. */
	public async appendOutput(command: ConversationComputerOutputCommand): Promise<"accepted" | "idempotent">
	{
		const turn = await this.dependencies.store.load(command.bootstrapId);
		if (turn === null)
			throw new Error("Conversation computer output requires an admitted bootstrap");
		await this._AdmitOutputPod(turn, command.workload);
		if (turn.toolReservation !== null)
			throw new Error("Conversation computer output cannot finish unresolved tool work");
		if (turn.outputSourceCommandId !== null)
		{
			if (turn.outputSourceCommandId !== command.sourceCommandId || turn.outputReceipt === null)
				throw new Error("Conversation computer turn already has a different output");
			const payload = await this.dependencies.outputPayloads.store(turn, command.sourceCommandId, command.text);
			const entry = turn.outputReceipt.event.data.entry;
			if (entry.kind !== "message" || entry.blocks.length !== 1 || entry.blocks[0].kind !== "text"
				|| entry.blocks[0].id !== payload.blockId || entry.blocks[0].payloadRef !== payload.payloadRef || entry.blocks[0].ciphertextDigest !== payload.ciphertextDigest)
				throw new Error("Conversation computer output retry has a different saved payload");
			await this._FinishOutput(turn, command.workload);
			return "idempotent";
		}
		await this.dependencies.candidates.assertCurrent(turn, command.workload);
		const payload = await this.dependencies.outputPayloads.store(turn, command.sourceCommandId, command.text);
		const writer = this.dependencies.writers.create(turn, command.workload);
		const receipt = await writer.prepare({ sourceCommandId: command.sourceCommandId, entry: { kind: "message", state: "completed", blocks: [{ id: payload.blockId, kind: "text", payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } });
		const decision = await this.dependencies.store.markOutput(turn.bootstrapId, receipt);
		await this._FinishOutput({ ...turn, outputSourceCommandId: decision.receipt.event.id, outputReceipt: decision.receipt }, command.workload);
		return decision.outcome;
	}

	/** Verify the current Pod without recompiling history that may already contain its accepted answer. */
	private async _AdmitOutputPod(turn: FrozenConversationComputerTurn, workload: ConversationComputerBootstrapCommand["workload"]): Promise<void>
	{
		if (turn.siloId !== this.dependencies.siloId)
			throw new Error("Conversation computer output crossed its admitted silo");
		await this.dependencies.candidates.admit({ computerId: turn.computerId, lease: turn.lease, workload });
	}

	/** Confirm the saved event before completing idempotent run, credential and active-pointer work. */
	private async _FinishOutput(turn: FrozenConversationComputerTurn, workload: ConversationComputerBootstrapCommand["workload"]): Promise<void>
	{
		if (turn.outputReceipt === null)
			throw new Error("Conversation computer output receipt is missing");
		await this._AdmitOutputPod(turn, workload);
		const writer = this.dependencies.writers.create(turn, workload);
		await writer.append(turn.outputReceipt);
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

/** Reads the computer's ownership coordinates back out of the frozen turn and its writer binding. */
function _ComputerScope(turn: FrozenConversationComputerTurn): ComputerScope
{
	return { siloId: turn.siloId, conversationId: turn.binding.conversationId, computerId: turn.computerId, agentIdentityId: turn.binding.agentIdentityId };
}

/**
 * Build the durable record field by field so compiled content can never ride along into the Kurrent event.
 *
 * The lease is copied from the candidate: the compiler received it from this same bootstrap command
 * and added the SandboxClaim the Pod-binding check proved.
 */
function _Freeze(candidate: ConversationComputerTurnCandidate, command: ConversationComputerBootstrapCommand, bootstrapId: string): FrozenConversationComputerTurn
{
	const input = candidate.compiledInput;
	return {
		bootstrapId,
		siloId: candidate.binding.siloId,
		computerId: command.computerId,
		lease: { leaseId: candidate.lease.leaseId, leaseGeneration: candidate.lease.leaseGeneration, sandboxClaimId: candidate.lease.sandboxClaimId },
		binding: candidate.binding,
		latestPendingEntryId: candidate.latestPendingEntryId,
		modelAlias: candidate.modelAlias,
		maximumBudgetUsd: candidate.maximumBudgetUsd,
		credentialLifetimeSeconds: candidate.credentialLifetimeSeconds,
		compile: { runId: input.runId, attempt: input.attempt, promptCompilerVersion: input.promptCompilerVersion, digest: input.digest },
		outputSourceCommandId: null,
		outputReceipt: null,
		toolReservation: null,
	};
}

/** Fail closed when a fresh compile does not reproduce the frozen anchor; the Pod never sees drifted input. */
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
	if (actual.bootstrapId !== expected.bootstrapId || actual.siloId !== expected.siloId || actual.computerId !== expected.computerId || actual.lease.leaseGeneration !== expected.lease.leaseGeneration || actual.lease.leaseId !== expected.lease.leaseId || actual.latestPendingEntryId !== expected.latestPendingEntryId || actual.binding.expectedRevision !== expected.binding.expectedRevision || actual.modelAlias !== expected.modelAlias)
		throw new Error("Conversation computer bootstrap conflicts with its durable turn record");
}
