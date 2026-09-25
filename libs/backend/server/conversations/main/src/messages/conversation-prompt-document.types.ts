import type { Prisma } from "@prisma/client";

import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Names the exact conversation history and requester used for one prompt compilation. */
export interface ConversationPromptDocumentPreparationCommand
{
	/** Silo that owns the conversation and every selected artifact. */
	readonly siloId: string;
	/** Conversation whose Kurrent history supplies the selected messages. */
	readonly conversationId: string;
	/** Last Kurrent revision admitted for this compile. */
	readonly historyRevision: string;
	/** Message identifiers in the order frozen into the run input. */
	readonly orderedMessageIds: readonly string[];
	/** Current authenticated participant whose source access must remain valid. */
	readonly requester: ConversationCaller;
}

/** One PDF block read from an exact completed human message in Kurrent history. */
export interface ConversationPromptDocumentReference
{
	/** Message that owns this block and receives the prepared text. */
	readonly messageId: string;
	/** Stable block identifier within the immutable message. */
	readonly blockId: string;
	/** Participant-visible source artifact. */
	readonly sourceArtifactId: string;
	/** Source PDF revision named by the immutable block. */
	readonly sourceRevisionId: string;
	/** Filename captured when the participant submitted the message. */
	readonly name: string;
	/** Media type captured with the immutable block. */
	readonly mediaType: string;
}

/** SQL-checked source binding and converted-text coordinates for one PDF block. */
export interface ResolvedConversationPromptDocument extends ConversationPromptDocumentReference
{
	/** Silo that owns the source and converted revisions. */
	readonly siloId: string;
	/** Conversation asset row that binds the source revision to the message. */
	readonly conversationAssetId: string;
	/** Exact byte length of the source PDF. */
	readonly sourceByteLength: number;
	/** Hidden artifact that holds the converted plain text. */
	readonly artifactId: string;
	/** Published converted-text revision. */
	readonly artifactRevisionId: string;
	/** SHA-256 address checked against the bytes returned by ArtifactStore. */
	readonly contentAddress: string;
	/** Exact UTF-8 length of the converted text before prompt framing. */
	readonly byteLength: number;
	/** Converted prompt input is always plain text. */
	readonly derivedMediaType: "text/plain";
}

/** One verified converted document held only for the current compile attempt. */
export interface PreparedConversationPromptDocument extends ResolvedConversationPromptDocument
{
	/** Text decoded with fatal UTF-8 after its length and digest were checked. */
	readonly text: string;
}

/** Complete command-local document set supplied to initial or replay compilation. */
export interface ConversationPromptDocumentPreparation
{
	/** Silo copied from the preparation command. */
	readonly siloId: string;
	/** Conversation copied from the preparation command. */
	readonly conversationId: string;
	/** Kurrent revision from which all document blocks were read. */
	readonly historyRevision: string;
	/** Exact ordered message set used to collect the blocks. */
	readonly orderedMessageIds: readonly string[];
	/** Prepared documents in message and block order. */
	readonly documents: readonly PreparedConversationPromptDocument[];
}

/** Transaction-bound current-authority and lineage checks owned by the asset package. */
export interface ConversationPromptDocumentAuthority
{
	/** Resolve every Kurrent block through its current message, source and converted-text facts. */
	resolve(command: ConversationPromptDocumentPreparationCommand, references: readonly ConversationPromptDocumentReference[]): Promise<readonly ResolvedConversationPromptDocument[]>;
	/** Recheck every prepared coordinate before a compiler may add its text to a prompt. */
	revalidate(command: ConversationPromptDocumentPreparationCommand, prepared: ConversationPromptDocumentPreparation): Promise<void>;
}

/** Creates one authority inside the SQL transaction that owns its read snapshot. */
export interface ConversationPromptDocumentAuthorityFactory
{
	/** Bind document checks to the caller's current transaction. */
	create(transaction: Prisma.TransactionClient): ConversationPromptDocumentAuthority;
}

/** Reads immutable published bytes through the server's existing ArtifactStore lease path. */
export interface ConversationPromptDocumentContentReader
{
	/** Open one exact derived revision and let the command timeout cancel the HTTP read. */
	read(input: { readonly siloId: string; readonly artifactId: string; readonly artifactRevisionId: string }, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

/** Prepares converted PDF text outside the final run-assembly transaction. */
export interface ConversationPromptDocumentPreparer
{
	/** Read the exact Kurrent set, resolve current authority, and verify every returned byte. */
	prepare(command: ConversationPromptDocumentPreparationCommand): Promise<ConversationPromptDocumentPreparation>;
}
