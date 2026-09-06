import { createHash } from "node:crypto";

import type { CompiledRunInput } from "@opencrane/contracts";

import type { ConversationComputerBootstrap, ConversationComputerBootstrapCommand, ConversationComputerOutputCommand, ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityPort, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Coordinates one durable, lease-fenced conversation turn for a bound sandbox Pod. */
export class ConversationComputerTurnAuthority implements ConversationComputerTurnAuthorityPort
{
	public constructor(private readonly dependencies: ConversationComputerTurnAuthorityDependencies) {}

	/**
	 * Freeze the next pending turn's coordinates, recompile against them, and issue the attempt-scoped model credential.
	 *
	 * Every bootstrap, first or retried, compiles the input again from the admitted run snapshot. The frozen
	 * Kurrent record holds only coordinates and a digest, so the recompiled digest must match before the Pod
	 * receives any content.
	 */
	public async bootstrap(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerBootstrap | null>
	{
		const active = await this.dependencies.store.loadActive({ siloId: this.dependencies.siloId, computerId: command.computerId, generation: command.generation, leaseId: command.leaseId });
		if (active !== null && active.outputReceipt !== null)
		{
			await this._FinishOutput(active, command.workload);
			return null;
		}
		const candidate = await this.dependencies.candidates.resolve(command);
		if (candidate === null)
			return null;
		const bootstrapId = _Uuid("bootstrap", [candidate.binding.siloId, command.computerId, String(command.generation), command.leaseId, candidate.latestPendingEntryId]);
		const proposed = _Freeze(candidate, command, bootstrapId);
		const turn = active ?? await this.dependencies.store.createOrRead(proposed);
		_AssertSameTurn(proposed, turn);
		_AssertRecompiledInput(turn, candidate.compiledInput);
		await this.dependencies.candidates.assertCurrent(turn, command.workload);
		if (turn.outputSourceCommandId !== null)
			return null;
		await this.dependencies.runLifecycle.start(_RunLifecycleCommand(turn));
		const keyAlias = `attempt-${createHash("sha256").update(turn.bootstrapId).digest("hex").slice(0, 40)}`;
		const snapshotBudget = candidate.compiledInput.budget.maxCostUsdMicros;
		const maxBudgetUsd = snapshotBudget === null ? turn.maximumBudgetUsd : Math.min(turn.maximumBudgetUsd, snapshotBudget / 1_000_000);
		const credential = await this.dependencies.credentials.issueOrRotate({ bootstrapId: turn.bootstrapId, siloId: turn.siloId, conversationId: turn.binding.conversationId, computerId: turn.computerId, leaseId: turn.leaseId, leaseGeneration: turn.generation, keyAlias, modelAlias: turn.modelAlias, maxBudgetUsd, expirySeconds: turn.credentialLifetimeSeconds });
		return { bootstrapId: turn.bootstrapId, compiledInput: candidate.compiledInput, modelCredential: { endpoint: this.dependencies.endpoint, key: credential.key, model: turn.modelAlias }, outcome: "ready" };
	}

	/** Persist assistant text as an encrypted payload and append its non-secret reference through the frozen writer. */
	public async appendOutput(command: ConversationComputerOutputCommand): Promise<"accepted" | "idempotent">
	{
		const turn = await this.dependencies.store.load(command.bootstrapId);
		if (turn === null)
			throw new Error("Conversation computer output requires an admitted bootstrap");
		await this.dependencies.candidates.assertCurrent(turn, command.workload);
		if (turn.outputSourceCommandId !== null)
		{
			if (turn.outputSourceCommandId !== command.sourceCommandId)
				throw new Error("Conversation computer turn already has a different output");
			await this._FinishOutput(turn, command.workload);
			return "idempotent";
		}
		const payload = await this.dependencies.outputPayloads.store(turn, command.sourceCommandId, command.text);
		const receipt = { sourceCommandId: command.sourceCommandId, ...payload };
		const outcome = await this.dependencies.store.markOutput(turn.bootstrapId, receipt);
		await this._FinishOutput({ ...turn, outputSourceCommandId: command.sourceCommandId, outputReceipt: receipt }, command.workload);
		return outcome;
	}

	private async _FinishOutput(turn: FrozenConversationComputerTurn, workload: ConversationComputerBootstrapCommand["workload"]): Promise<void>
	{
		if (turn.outputReceipt === null)
			throw new Error("Conversation computer output receipt is missing");
		const writer = this.dependencies.writers.create(turn, workload);
		await writer.append({ sourceCommandId: turn.outputReceipt.sourceCommandId, entry: { kind: "message", state: "completed", blocks: [{ id: turn.outputReceipt.blockId, kind: "text", payloadRef: turn.outputReceipt.payloadRef, ciphertextDigest: turn.outputReceipt.ciphertextDigest }], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } });
		await this.dependencies.runLifecycle.complete(_RunLifecycleCommand(turn));
		await this.dependencies.credentials.revoke(turn.bootstrapId);
		await this.dependencies.store.settle(turn);
	}
}

/** Copies only the immutable attempt and lease fence needed by run lifecycle. */
function _RunLifecycleCommand(turn: FrozenConversationComputerTurn)
{
	return { runId: turn.compile.runId, siloId: turn.siloId, attempt: turn.compile.attempt, computerId: turn.computerId, leaseId: turn.leaseId, leaseGeneration: turn.generation };
}

/** Build the durable record field by field so compiled content can never ride along into the Kurrent event. */
function _Freeze(candidate: ConversationComputerTurnCandidate, command: ConversationComputerBootstrapCommand, bootstrapId: string): FrozenConversationComputerTurn
{
	const input = candidate.compiledInput;
	return {
		bootstrapId,
		siloId: candidate.binding.siloId,
		computerId: command.computerId,
		generation: command.generation,
		leaseId: command.leaseId,
		binding: candidate.binding,
		latestPendingEntryId: candidate.latestPendingEntryId,
		modelAlias: candidate.modelAlias,
		maximumBudgetUsd: candidate.maximumBudgetUsd,
		credentialLifetimeSeconds: candidate.credentialLifetimeSeconds,
		sandboxClaimId: candidate.sandboxClaimId,
		compile: { runId: input.runId, attempt: input.attempt, promptCompilerVersion: input.promptCompilerVersion, digest: input.digest },
		outputSourceCommandId: null,
		outputReceipt: null,
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
	if (actual.bootstrapId !== expected.bootstrapId || actual.siloId !== expected.siloId || actual.computerId !== expected.computerId || actual.generation !== expected.generation || actual.leaseId !== expected.leaseId || actual.latestPendingEntryId !== expected.latestPendingEntryId || actual.binding.expectedRevision !== expected.binding.expectedRevision || actual.modelAlias !== expected.modelAlias)
		throw new Error("Conversation computer bootstrap conflicts with its durable turn record");
}
