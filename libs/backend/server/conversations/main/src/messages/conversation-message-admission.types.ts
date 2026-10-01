import type { Prisma } from "@prisma/client";

import type { ConversationCaller } from "../authorization/conversation-caller.types";
import type { ConversationMessageAdmissionResult, ConversationMessageCommand } from "./self-conversation-history.types";

/** Writes one participant message through SQL admission and checked immutable history. */
export interface ConversationMessageAdmission
{
	/** Commits or recovers one exact participant message command. */
	post(caller: ConversationCaller, conversationId: string, command: ConversationMessageCommand): Promise<ConversationMessageAdmissionResult | null>;
}

/** Safe immutable artifact coordinates returned by the attachment authority. */
export interface ConversationMessageAttachment
{
	/** Identifies the selected conversation asset in canonical command order. */
	readonly assetId: string;
	/** Identifies the artifact that owns the published revision. */
	readonly artifactId: string;
	/** Identifies the immutable artifact revision bound to the message. */
	readonly artifactRevisionId: string;
	/** Captures the participant-visible filename at message admission. */
	readonly name: string;
	/** Captures the verified media type at message admission. */
	readonly mediaType: string;
}

/** Command passed to the transaction-scoped conversation attachment authority. */
export interface ConversationMessageAttachmentAdmissionCommand
{
	/** Carries server-resolved participant identity and silo coordinates. */
	readonly caller: ConversationCaller;
	/** Identifies the currently authorized conversation. */
	readonly conversationId: string;
	/** Identifies the immutable message and the payload retry row. */
	readonly messageId: string;
	/** Lists unique selected asset identifiers in ASCII order. */
	readonly canonicalAssetIds: readonly string[];
	/** States whether this transaction created the payload retry row. */
	readonly payloadCreated: boolean;
}

/** Safe attachment metadata returned after an atomic bind or exact retry check. */
export interface ConversationMessageAttachmentAdmissionResult
{
	/** Preserves the canonical selected-asset order for block construction. */
	readonly attachments: readonly ConversationMessageAttachment[];
}

/** Binds new message attachments or verifies the immutable binding on a retry. */
export interface ConversationMessageAttachmentAdmission
{
	/**
	 * Binds every selected Ready participant asset when the payload was created, or verifies the
	 * historical set when it was replayed. Returns null when current authority denies the operation.
	 * The caller treats null as a transaction rollback and never commits a partial payload.
	 */
	bindOrVerify(command: ConversationMessageAttachmentAdmissionCommand): Promise<ConversationMessageAttachmentAdmissionResult | null>;
}

/** Constructs the attachment authority over the message admission's Serializable transaction. */
export type ConversationMessageAttachmentAdmissionFactory = (transaction: Prisma.TransactionClient) => ConversationMessageAttachmentAdmission;
