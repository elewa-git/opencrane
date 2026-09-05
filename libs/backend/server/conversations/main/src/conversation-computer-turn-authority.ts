import { createHash } from "node:crypto";

import type { ConversationComputerBootstrap, ConversationComputerBootstrapCommand, ConversationComputerOutputCommand, ConversationComputerTurnAuthority as ConversationComputerTurnAuthorityPort, ConversationComputerTurnAuthorityDependencies, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Coordinates one durable, lease-fenced conversation turn for a bound sandbox Pod. */
export class ConversationComputerTurnAuthority implements ConversationComputerTurnAuthorityPort
{
	public constructor(private readonly dependencies: ConversationComputerTurnAuthorityDependencies) {}

	/** Freeze the next pending input before issuing its attempt-scoped model credential. */
	public async bootstrap(command: ConversationComputerBootstrapCommand): Promise<ConversationComputerBootstrap | null>
	{
		const candidate = await this.dependencies.candidates.resolve(command);
		if (candidate === null)
			return null;
		const bootstrapId = _Uuid("bootstrap", [candidate.binding.siloId, command.computerId, String(command.generation), command.leaseId, candidate.latestPendingEntryId]);
		const proposed: FrozenConversationComputerTurn = { ...candidate, bootstrapId, computerId: command.computerId, generation: command.generation, leaseId: command.leaseId, siloId: candidate.binding.siloId, outputSourceCommandId: null };
		const turn = await this.dependencies.store.createOrRead(proposed);
		_AssertSameTurn(proposed, turn);
		await this.dependencies.candidates.assertCurrent(turn, command.workload);
		if (turn.outputSourceCommandId !== null)
			return null;
		const keyAlias = `attempt-${createHash("sha256").update(turn.bootstrapId).digest("hex").slice(0, 40)}`;
		const credential = await this.dependencies.credentials.issueOrRotate({ bootstrapId: turn.bootstrapId, siloId: turn.siloId, conversationId: turn.binding.conversationId, keyAlias, modelAlias: turn.modelAlias, maxBudgetUsd: turn.maximumBudgetUsd, expirySeconds: turn.credentialLifetimeSeconds });
		return { bootstrapId: turn.bootstrapId, compiledInput: turn.compiledInput, modelCredential: { endpoint: this.dependencies.endpoint, key: credential.key, model: turn.modelAlias }, outcome: "ready" };
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
			await this.dependencies.credentials.revoke(turn.bootstrapId);
			return "idempotent";
		}
		const payload = await this.dependencies.outputPayloads.store(turn, command.sourceCommandId, command.text);
		const writer = this.dependencies.writers.create(turn, command.workload);
		await writer.append({ sourceCommandId: command.sourceCommandId, entry: { kind: "message", state: "completed", blocks: [{ id: payload.blockId, kind: "text", payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } });
		const outcome = await this.dependencies.store.markOutput(turn.bootstrapId, command.sourceCommandId);
		await this.dependencies.credentials.revoke(turn.bootstrapId);
		return outcome;
	}
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
	if (actual.bootstrapId !== expected.bootstrapId || actual.siloId !== expected.siloId || actual.computerId !== expected.computerId || actual.generation !== expected.generation || actual.leaseId !== expected.leaseId || actual.latestPendingEntryId !== expected.latestPendingEntryId || actual.binding.expectedRevision !== expected.binding.expectedRevision || actual.compiledInput.digest !== expected.compiledInput.digest || actual.modelAlias !== expected.modelAlias)
		throw new Error("Conversation computer bootstrap conflicts with its durable turn record");
}
