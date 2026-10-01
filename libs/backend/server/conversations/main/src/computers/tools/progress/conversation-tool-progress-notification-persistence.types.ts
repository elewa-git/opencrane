import type { ConversationToolProgressNotificationEvidence, ConversationToolRequestedNotificationCommand, ConversationToolRunningNotificationCommand } from "../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";

/** SQL facts retained from the exact run-owned proposal row. */
export interface ConversationToolRequestedNotificationRecord
{
	/** Silo that owns the invocation row. */
	readonly siloId: string;
	/** Run that owns the invocation row. */
	readonly runId: string | null;
	/** Attempt that owns the invocation row. */
	readonly attempt: number | null;
	/** Task ownership is excluded from conversation-computer progress. */
	readonly mcpTaskId: string | null;
	/** Conversation computer that admitted the invocation. */
	readonly runtimeInstanceId: string;
	/** Saved bootstrap command that admitted the invocation. */
	readonly commandId: string;
	/** Accepted candidate retained by the proposal row. */
	readonly candidateId: string | null;
	/** Frozen tool revision selected by the invocation. */
	readonly toolRevisionId: string;
	/** Stable public tool call shared by participant entries. */
	readonly toolInvocationId: string;
	/** Digest of the admitted tool name and arguments. */
	readonly requestFingerprint: string;
	/** Durable proposal creation time used by both progress producers. */
	readonly createdAt: Date;
}

/** Reads the exact admitted proposal row inside one caller-owned transaction. */
export interface ConversationToolRequestedNotificationRepository
{
	/** Return the saved row at the unique run, attempt and public invocation coordinates. */
	readExact(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolRequestedNotificationRecord | null>;
}

/** Rechecks all SQL-owned running evidence inside one caller-owned transaction. */
export interface ConversationToolRunningNotificationRepository
{
	/** Return safe display facts only while every current dispatch bound still matches. */
	readCurrent(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>;
}
