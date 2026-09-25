import type { ConversationElicitation } from "@opencrane/contracts";

/** Immutable turn and approval coordinates used to publish one requested notification. */
export interface ConversationApprovalNotificationCommand
{
	/** Identifies the durable turn whose workflow reached the approval wait. */
	readonly bootstrapId: string;
	/** Identifies the configured silo that owns the turn. */
	readonly siloId: string;
	/** Identifies the conversation that receives the safe history entry. */
	readonly conversationId: string;
	/** Identifies the run that opened the approval. */
	readonly runId: string;
	/** Fences the notification to the run attempt that opened the approval. */
	readonly attempt: number;
	/** Identifies the approval and its elicitation without exposing either payload. */
	readonly approvalId: string;
}

/** Closed result of publishing or safely suppressing a requested notification. */
export enum ConversationApprovalNotificationOutcomes
{
	/** The exact participant-visible entry is durably recorded. */
	Published = "published",
	/** Current request or recipient authority no longer permits a new notification. */
	NoLongerVisible = "no_longer_visible",
}

/** Server-owned effect called by the durable conversation-turn workflow. */
export interface ConversationApprovalNotificationPort
{
	/** Publish or recover the exact requested entry without granting approval or tool execution. */
	publishRequested(command: ConversationApprovalNotificationCommand): Promise<ConversationApprovalNotificationOutcomes>;
}

/** Current PostgreSQL authority used before any new participant history append. */
export interface ConversationApprovalNotificationRequestReader
{
	/** Return the exact open owned request, or null after expiry, resolution, or revocation. */
	readCurrent(command: ConversationApprovalNotificationCommand, now: Date): Promise<ConversationElicitation | null>;
}

/** Supplies server time to current request checks without hiding time in tests. */
export interface ConversationApprovalNotificationClock
{
	/** Return the current trusted server instant. */
	now(): Date;
}
