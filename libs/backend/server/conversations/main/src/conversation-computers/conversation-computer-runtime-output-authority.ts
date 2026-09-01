import { createHash } from "node:crypto";

import { ___ConversationEntrySchema, ConversationEntryKinds, type ConversationAuthor, type ConversationEntry, type MessageEntry } from "@opencrane/contracts";
import { HistoryExpectedRevisions } from "@opencrane/backend/server/infra/history-store";

import type { CurrentConversationHistory } from "../conversation-history-reader.types";
import type { ConversationComputerRuntimeOutputAuthorityDependencies, ConversationComputerRuntimeOutputCommand, ConversationComputerRuntimeOutputResult } from "./conversation-computer-runtime-output-authority.types";

/** Identifies the only terminal message state this authority may publish for a completed command. */
const _TerminalOutputStates = new Set<MessageEntry["state"]>(["completed"]);
/** Identifies the only author class derived from an active ConversationComputer identity. */
const _RuntimeAgentAuthorKinds = new Set<ConversationAuthor["kind"]>(["agent"]);
/** Identifies the provenance retained when the runtime output authority stamps the agent entry. */
const _RuntimeAgentProvenances = new Set<ConversationEntry["provenance"]>(["agent-authored"]);
/** Identifies the only participant audience that a runtime output may use without a separate disclosure grant. */
const _ConversationAudiences = new Set<MessageEntry["visibility"]["audience"]>(["conversation"]);
/** Identifies the only activation state a completed runtime response may publish. */
const _TerminalOutputActivations = new Set<MessageEntry["activation"]>(["none"]);
/** Separates deterministic output identifiers from the initiating conversation-entry UUID namespace. */
const _OUTPUT_IDENTIFIER_NAMESPACE = "opencrane.conversation-computer-runtime-output.v1";

/** Owns the atomic command-claim and opaque-message append for runtime output. */
export class ConversationComputerRuntimeOutputAuthority
{
	/** Binds all narrow read, encryption, claim, clock, and atomic-append ports for this authority. */
	public constructor(private readonly dependencies: ConversationComputerRuntimeOutputAuthorityDependencies)
	{
	}

	/**
	 * Stores and atomically records the sole successful output for one server-issued runtime command.
	 *
	 * The output claim is the command's success transition: it shares one `appendAtomic` call with
	 * the conversation entry, so a terminal report, a competing output, or a changed execution head
	 * cannot leave a participant-visible response without its command lifecycle fence.
	 *
	 * Called by: the forthcoming authenticated ConversationComputer runtime output route.
	 * @param command - Supplies the runtime's already-authenticated output bytes and echoed command fence.
	 * @returns The UUID message identifier, including the exact durable winner for a response-lost retry.
	 * @throws {Error} Rejects malformed text, retired execution fences, changed retries, and append conflicts.
	 */
	public async record(command: ConversationComputerRuntimeOutputCommand): Promise<ConversationComputerRuntimeOutputResult>
	{
		_Validate(command);
		const outputMessageId = _OutputMessageId(command.commandId);

		// 1. Recheck active runtime and identity state so the caller cannot choose an author or retired execution.
		const computer = await this.dependencies.computers.loadActiveExecutionForRuntime({
			siloId: command.siloId,
			computerId: command.computerId,
			conversationId: command.conversationId,
			profileRevisionId: command.profileRevisionId,
			nowEpochMilliseconds: this.dependencies.clock.now().getTime(),
		});
		if (computer.execution.id !== command.executionId || computer.lease.generation !== command.leaseGeneration)
			throw new Error("Conversation computer runtime output has foreign execution coordinates");
		const identity = await this.dependencies.identities.loadActiveAuthorization({ siloId: command.siloId, agentIdentityId: computer.computer.agentIdentityId });

		// 2. Replay the transcript and retain opaque output coordinates before comparing an exact retry.
		const conversation = await this.dependencies.conversations.readCurrent({ siloId: command.siloId, conversationId: command.conversationId });
		const payload = await this.dependencies.payloads.storeText({ siloId: command.siloId, conversationId: command.conversationId, idempotencyKey: outputMessageId, text: command.text });
		const existingMessageId = _ExistingMessageId(conversation, command, outputMessageId, computer.execution.id, identity.identity, identity.agentServiceId, payload);
		if (existingMessageId !== null)
			return { messageId: existingMessageId };

		// 3. Build both state transitions from current heads, then append them as one all-or-nothing fact.
		const claim = await this.dependencies.claims.prepareOutputClaim(command);
		const entry = _Entry(command, outputMessageId, conversation.expectedRevision, identity.identity, identity.agentServiceId, payload, this.dependencies.clock.now());
		if (!___ConversationEntrySchema.safeParse(entry).success)
			throw new Error("Conversation computer runtime output could not stamp a valid message entry");
		await this.dependencies.history.appendAtomic({
			expectedHeads: [
				claim.expectedHead,
				{ streamName: computer.streamName, revision: computer.revision },
				{ streamName: conversation.streamName, revision: conversation.expectedRevision },
				...identity.expectedIdentityHeads,
			],
			appends: [
				claim.append,
				{
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
							executionId: command.executionId,
							leaseGeneration: command.leaseGeneration,
							commandId: command.commandId,
							causationId: entry.causationId,
							correlationId: entry.correlationId,
							idempotencyKey: entry.idempotencyKey,
						},
					}],
				},
			],
		});
		return { messageId: entry.id };
	}
}

/** Returns a durable output winner only when every server-stamped message field matches the retry. */
function _ExistingMessageId(conversation: CurrentConversationHistory, command: ConversationComputerRuntimeOutputCommand, outputMessageId: string, executionId: string, identity: { readonly id: string; readonly name: string; readonly avatarArtifactRevisionId: string | null }, agentServiceId: string, payload: { readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }): string | null
{
	const entry = conversation.entries.find(candidate => candidate.idempotencyKey === outputMessageId);
	if (entry === undefined)
		return null;
	const block = entry.kind === ConversationEntryKinds.Message ? entry.blocks[0] : undefined;
	const author = entry.author;
	const isExactAgentAuthor = _RuntimeAgentAuthorKinds.has(author.kind)
		&& "agentIdentityId" in author
		&& "agentServiceId" in author
		&& author.agentIdentityId === identity.id
		&& author.agentServiceId === agentServiceId
		&& author.name === identity.name
		&& author.avatarArtifactRevisionId === identity.avatarArtifactRevisionId;
	const isExactOutput = entry.kind === ConversationEntryKinds.Message
		&& entry.id === outputMessageId
		&& _TerminalOutputStates.has(entry.state)
		&& isExactAgentAuthor
		&& _RuntimeAgentProvenances.has(entry.provenance)
		&& _ConversationAudiences.has(entry.visibility.audience)
		&& entry.runId === null
		&& entry.causationId === command.commandId
		&& entry.correlationId === executionId
		&& entry.replyToEntryId === null
		&& entry.addressedAgentIdentityId === null
		&& _TerminalOutputActivations.has(entry.activation)
		&& entry.blocks.length === 1
		&& block !== undefined
		&& "payloadRef" in block
		&& "ciphertextDigest" in block
		&& block.id === "text"
		&& block.payloadRef === payload.payloadRef
		&& block.ciphertextDigest === payload.ciphertextDigest;
	if (!isExactOutput)
		throw new Error("Conversation computer runtime output command already owns a different conversation entry");
	return entry.id;
}

/** Builds one opaque agent-authored message entirely from the checked runtime and identity state. */
function _Entry(command: ConversationComputerRuntimeOutputCommand, outputMessageId: string, conversationRevision: HistoryExpectedRevisions.NoStream | bigint, identity: { readonly id: string; readonly name: string; readonly avatarArtifactRevisionId: string | null }, agentServiceId: string, payload: { readonly payloadRef: `payload://${string}`; readonly ciphertextDigest: `sha256:${string}` }, now: Date): MessageEntry
{
	const position = conversationRevision === HistoryExpectedRevisions.NoStream
		? "0"
		: (conversationRevision + 1n).toString();
	return {
		schemaVersion: 1,
		id: outputMessageId,
		conversationId: command.conversationId,
		position,
		author: { kind: "agent", agentIdentityId: identity.id, agentServiceId, name: identity.name, avatarArtifactRevisionId: identity.avatarArtifactRevisionId },
		provenance: "agent-authored",
		visibility: { audience: "conversation" },
		runId: null,
		causationId: command.commandId,
		correlationId: command.executionId,
		idempotencyKey: outputMessageId,
		occurredAt: now.toISOString(),
		attestation: null,
		kind: ConversationEntryKinds.Message,
		state: "completed",
		blocks: [{ id: "text", kind: "text", payloadRef: payload.payloadRef, ciphertextDigest: payload.ciphertextDigest }],
		replyToEntryId: null,
		addressedAgentIdentityId: null,
		activation: "none",
	};
}

/** Derives a stable version-five UUID for the output message without reusing the input entry UUID. */
function _OutputMessageId(commandId: string): string
{
	const bytes = createHash("sha256").update(_OUTPUT_IDENTIFIER_NAMESPACE).update("\u0000").update(commandId).digest().subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Rejects caller data that cannot name one bounded output for the current runtime command. */
function _Validate(command: ConversationComputerRuntimeOutputCommand): void
{
	const identifiers = [command.siloId, command.computerId, command.conversationId, command.commandId, command.executionId, command.profileRevisionId];
	if (!identifiers.every(_Identifier) || !Number.isSafeInteger(command.leaseGeneration) || command.leaseGeneration <= 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.commandId))
		throw new Error("Conversation computer runtime output requires valid command coordinates");
	if (command.text.trim().length === 0 || Buffer.byteLength(command.text, "utf8") > 64 * 1024)
		throw new Error("Conversation computer runtime output requires bounded non-blank text");
}

/** Accepts an opaque coordinate only when it is nonblank and has no surrounding whitespace. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}
