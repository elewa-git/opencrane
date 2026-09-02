import { ConversationEntryKinds, ConversationLifecycleModes, type MessageEntry } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import type { CurrentConversationHistory } from "../conversation-history-reader.types";
import type { ConversationComputerParticipantInputAuthorityDependencies, ConversationComputerParticipantInputCommand, ConversationComputerParticipantInputEntry, ConversationComputerParticipantInputResult } from "./conversation-computer-participant-input-authority.types";

/** Recognizes UUID input identifiers used as both stream event and idempotency keys. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Records a participant's agent-session input before a computer is warm enough to receive work.
 *
 * A participant message is history first: this authority writes a human-authored opaque entry to
 * `conversation-{id}` after its caller has checked current membership. A later durable command
 * worker consumes that entry after the bound computer has an active execution. Keeping the input
 * independent of a warm Pod preserves a message submitted during cold start without recreating an
 * AgentRun lifecycle.
 *
 * Called by: the target participant-message admission composition for issue #759.
 * @see ConversationComputerRuntimeCommandAuthority for the later execution-fenced command issue.
 */
export class ConversationComputerParticipantInputAuthority
{
	/** Connects participant input to the checked conversation stream and ciphertext store. */
	public constructor(private readonly dependencies: ConversationComputerParticipantInputAuthorityDependencies)
	{
	}

	/**
	 * Stores an opaque human-authored start entry or returns the original matching entry on retry.
	 *
	 * The caller has already proved current membership and selected the human author. This authority
	 * still replays the creation record to ensure the conversation is an agent session and that the
	 * supplied computer is the one frozen at creation. It stores the private body before the history
	 * append, because a lost response can then prove the same payload and entry without writing a
	 * different message.
	 *
	 * @param command - Supplies trusted participant coordinates, the bound computer, and bounded text.
	 * @returns The participant entry id for a new write or an exact response-lost retry.
	 * @throws {Error} Rejects a non-agent conversation, foreign participant or computer, changed retry, and stale history.
	 */
	public async admit(command: ConversationComputerParticipantInputCommand): Promise<ConversationComputerParticipantInputResult>
	{
		_Validate(command);

		// 1. Confirm the frozen agent binding before a caller-selected computer can reach history.
		const creation = await this.dependencies.conversations.readCreation({ siloId: command.siloId, conversationId: command.conversationId });
		_AssertBoundAgentConversation(creation, command);

		// 2. Replay the current transcript before retaining a new payload so retries reuse their entry.
		const conversation = await this.dependencies.conversations.readCurrent({ siloId: command.siloId, conversationId: command.conversationId });
		if (conversation.expectedRevision === HistoryExpectedRevisions.NoStream)
			throw new Error("Conversation computer participant input requires a creation-anchored conversation history");
		const existing = _ExistingInput(conversation, command);
		const payload = await this.dependencies.payloads.storeText({ siloId: command.siloId, conversationId: command.conversationId, idempotencyKey: command.inputId, text: command.text });
		if (existing !== null)
		{
			_AssertMatchingInput(existing, command, payload);
			return { inputEntryId: existing.id };
		}

		// 3. Append the input under the checked head so a concurrent participant write must re-authorize.
		const entry = _Entry(command, conversation.expectedRevision, payload, this.dependencies.clock.now());
		await this.dependencies.history.appendAtomic({
			expectedHeads: [{ streamName: conversation.streamName, revision: conversation.expectedRevision }],
			appends: [{
				streamName: conversation.streamName,
				expectedRevision: conversation.expectedRevision,
				events: [{
					id: entry.id,
					type: "opencrane.conversation-entry.v1",
					data: { entry },
					metadata: {
						siloId: command.siloId,
						conversationId: command.conversationId,
						computerId: command.computerId,
						causationId: entry.causationId,
						correlationId: entry.correlationId,
						idempotencyKey: entry.idempotencyKey,
					},
				}],
			}],
		});
		return { inputEntryId: entry.id };
	}
}

/** Rejects input that does not name the agent computer frozen in the creation anchor. */
function _AssertBoundAgentConversation(creation: Awaited<ReturnType<ConversationComputerParticipantInputAuthorityDependencies["conversations"]["readCreation"]>>, command: ConversationComputerParticipantInputCommand): void
{
	if (creation.mode !== ConversationLifecycleModes.Agent || creation.agentBinding === null || creation.agentBinding.computerId !== command.computerId)
		throw new Error("Conversation computer participant input requires its creation-bound agent computer");
	if (!creation.participants.some(participant => participant.userId === command.author.participantId))
		throw new Error("Conversation computer participant input caller is not an initial participant");
}

/** Finds the idempotency entry without treating another entry kind as a successful retry. */
function _ExistingInput(conversation: CurrentConversationHistory, command: ConversationComputerParticipantInputCommand): ConversationComputerParticipantInputEntry | null
{
	const entry = conversation.entries.find(candidate => candidate.idempotencyKey === command.inputId);
	if (entry === undefined)
		return null;
	if (entry.kind !== ConversationEntryKinds.Message)
		throw new Error("Conversation computer participant input idempotency key already owns another entry kind");
	return entry;
}

/** Checks that a response-lost retry points to the same stored message and private input body. */
function _AssertMatchingInput(entry: ConversationComputerParticipantInputEntry, command: ConversationComputerParticipantInputCommand, payload: { readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }): void
{
	const block = entry.blocks[0];
	const matchingAuthor = entry.author.kind === "human"
		&& entry.author.principalId === command.author.principalId
		&& entry.author.participantId === command.author.participantId
		&& entry.author.name === command.author.name
		&& entry.author.avatarArtifactRevisionId === command.author.avatarArtifactRevisionId;
	const matchingPayload = block !== undefined
		&& block.kind === "text"
		&& block.id === "text"
		&& block.payloadRef === payload.payloadRef
		&& block.ciphertextDigest === payload.ciphertextDigest;
	if (entry.id !== command.inputId || entry.state !== "completed" || entry.provenance !== "human-authored" || entry.visibility.audience !== "conversation" || entry.runId !== null || entry.causationId !== command.inputId || entry.correlationId !== command.inputId || entry.blocks.length !== 1 || entry.replyToEntryId !== null || entry.addressedAgentIdentityId !== null || entry.activation !== "start" || !matchingAuthor || !matchingPayload)
		throw new Error("Conversation computer participant input idempotency key already owns different input");
}

/** Builds the opaque participant entry from the checked history head and server-owned timestamp. */
function _Entry(command: ConversationComputerParticipantInputCommand, revision: bigint, payload: { readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }, now: Date): MessageEntry
{
	return {
		schemaVersion: 1,
		id: command.inputId,
		conversationId: command.conversationId,
		position: (revision + 1n).toString(),
		author: { kind: "human", principalId: command.author.principalId, participantId: command.author.participantId, name: command.author.name, avatarArtifactRevisionId: command.author.avatarArtifactRevisionId },
		provenance: "human-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: command.inputId,
		correlationId: command.inputId,
		idempotencyKey: command.inputId,
		occurredAt: _Now(now),
		attestation: null,
		kind: ConversationEntryKinds.Message,
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "start",
	};
}

/** Validates server-derived coordinates and bounded participant text before any external write. */
function _Validate(command: ConversationComputerParticipantInputCommand): void
{
	const identifiers = [command.siloId, command.conversationId, command.computerId, command.author.principalId, command.author.participantId, command.author.name];
	if (!identifiers.every(_Identifier) || !_UUID_PATTERN.test(command.inputId))
		throw new Error("Conversation computer participant input requires valid server coordinates");
	if (command.text.trim().length === 0 || Buffer.byteLength(command.text, "utf8") > 64 * 1024)
		throw new Error("Conversation computer participant input requires bounded non-blank text");
}

/** Returns a valid ISO timestamp after rejecting a broken injected server clock. */
function _Now(now: Date): string
{
	if (!Number.isFinite(now.getTime()))
		throw new Error("Conversation computer participant input requires a valid server clock");
	return now.toISOString();
}

/** Accepts an identifier only when it is nonblank and has no surrounding whitespace. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
