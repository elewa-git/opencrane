import { ConversationEntryKinds, type ConversationComputerRuntimePrivatePayloadReference, type ConversationEntry } from "@opencrane/contracts";

import type { ConversationComputerParticipantInputDispatchAuthorityDependencies, ConversationComputerParticipantInputDispatchCommand, ConversationComputerParticipantInputDispatchResult } from "./conversation-computer-participant-input-dispatch-authority.types";

/** Recognizes UUID participant entries that the runtime command authority accepts as command ids. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Recognizes opaque payload references retained by the private payload store. */
const _PAYLOAD_REFERENCE_PATTERN = /^payload:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Recognizes ciphertext digests that bind the protected participant body. */
const _DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/iu;

/**
 * Converts retained human start entries into runtime commands after a computer has an execution.
 *
 * Participant input remains in the conversation stream while its computer is cold. The sandbox
 * reconciliation worker calls this authority after it has started a server-owned execution; each
 * command then rechecks that execution before it appends. Command issue is idempotent by input id,
 * so replaying the same conversation after a process restart cannot duplicate work.
 *
 * Called by: the ConversationComputer sandbox reconciliation composition.
 * @see ConversationComputerParticipantInputAuthority for the history writer that creates these entries.
 */
export class ConversationComputerParticipantInputDispatchAuthority
{
	/** Connects input replay to the command authority that owns active-execution fencing. */
	public constructor(private readonly dependencies: ConversationComputerParticipantInputDispatchAuthorityDependencies)
	{
	}

	/**
	 * Issues or replays every retained human start entry for the current computer execution.
	 *
	 * The conversation reader validates KurrentDB event envelopes before this method sees an entry.
	 * This method narrows further to the one target input shape, then hands each entry to the command
	 * authority in transcript order. A cold, replaced, or expired computer fails in that authority;
	 * callers retry after reconciliation rather than manufacturing a command from a stale lease.
	 *
	 * @param command - Names trusted conversation and computer coordinates selected by the app.
	 * @returns The count of inputs that reached the idempotent command issuer.
	 * @throws {Error} Rejects malformed coordinates or an invalid retained target input entry.
	 */
	public async dispatch(command: ConversationComputerParticipantInputDispatchCommand): Promise<ConversationComputerParticipantInputDispatchResult>
	{
		_Validate(command);
		const conversation = await this.dependencies.conversations.readCurrent({ siloId: command.siloId, conversationId: command.conversationId });
		const inputs = conversation.entries.filter(_IsParticipantStartInput);
	for (const input of inputs)
	{
		const block = input.blocks[0];
		const payload = _PayloadCoordinates(block);
		await this.dependencies.commands.issueStartTurn({
				siloId: command.siloId,
				conversationId: command.conversationId,
				computerId: command.computerId,
				inputEntryId: input.id,
			inputPayloadRef: payload.payloadRef,
			inputPayloadDigest: payload.ciphertextDigest,
			});
		}
		return { dispatchedInputCount: inputs.length };
	}
}

/** Converts a validated text block into the narrower runtime payload coordinate contract. */
function _PayloadCoordinates(block: Extract<ConversationEntry, { readonly kind: "message" }>["blocks"][number] | undefined): { readonly payloadRef: ConversationComputerRuntimePrivatePayloadReference; readonly ciphertextDigest: `sha256:${string}` }
{
	if (block === undefined || block.kind !== "text" || !_PAYLOAD_REFERENCE_PATTERN.test(block.payloadRef) || !_DIGEST_PATTERN.test(block.ciphertextDigest))
		throw new Error("Conversation computer participant input dispatch found an invalid retained payload");
	return { payloadRef: block.payloadRef as ConversationComputerRuntimePrivatePayloadReference, ciphertextDigest: block.ciphertextDigest as `sha256:${string}` };
}

/** Narrows a validated history entry to the target human input shape or rejects a lookalike entry. */
function _IsParticipantStartInput(entry: ConversationEntry): entry is Extract<ConversationEntry, { readonly kind: "message" }>
{
	if (entry.kind !== ConversationEntryKinds.Message || entry.activation !== "start" || entry.author.kind !== "human")
		return false;
	if (entry.id !== entry.idempotencyKey || !_UUID_PATTERN.test(entry.id) || entry.state !== "completed" || entry.provenance !== "human-authored" || entry.visibility.audience !== "conversation" || entry.runId !== null || entry.causationId !== entry.id || entry.correlationId !== entry.id || entry.blocks.length !== 1 || entry.replyToEntryId !== null || entry.addressedAgentIdentityId !== null)
		throw new Error("Conversation computer participant input dispatch found an invalid retained input entry");
	return true;
}

/** Rejects caller-selected coordinates before they reach conversation or command history. */
function _Validate(command: ConversationComputerParticipantInputDispatchCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.conversationId) || !_Identifier(command.computerId))
		throw new Error("Conversation computer participant input dispatch requires trusted coordinates");
}

/** Accepts an identifier only when it is nonblank and has no surrounding whitespace. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
