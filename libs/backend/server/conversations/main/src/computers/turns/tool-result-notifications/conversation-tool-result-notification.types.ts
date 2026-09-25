import type { ToolCallLogEntry } from "@opencrane/contracts";
import type { ToolResultDeliveryPayload } from "@opencrane/backend/server/iam/authorization";

/** Immutable coordinates used to publish one terminal tool-result fact. */
export interface ConversationToolResultNotificationCommand
{
	/** Identifies the durable turn that selected the tool. */
	readonly bootstrapId: string;
	/** Identifies the silo that owns the turn and conversation. */
	readonly siloId: string;
	/** Identifies the conversation that receives the safe history entry. */
	readonly conversationId: string;
	/** Identifies the run that owns the tool invocation. */
	readonly runId: string;
	/** Fences the notification to the run attempt that selected the tool. */
	readonly attempt: number;
	/** Identifies the public tool invocation selected by the saved turn. */
	readonly toolInvocationId: string;
	/** Requires the current durable result to match the privately retained continuation. */
	readonly expectedResultDigest: string;
}

/** Safe current evidence from the frozen definition and durable terminal result. */
export interface ConversationToolResultNotificationEvidence
{
	/** Captures the immutable tool display name from the compiled run input. */
	readonly toolName: string;
	/** Classifies the selected MCP tool for the participant log. */
	readonly toolKind: ToolCallLogEntry["toolKind"];
	/** Distinguishes a canonical result from a terminal provider failure. */
	readonly outcome: ToolResultDeliveryPayload["outcome"];
	/** Binds the private receipt to the complete durable delivery without disclosing its content. */
	readonly resultDigest: string;
	/** Preserves the durable provider completion time across retries. */
	readonly occurredAt: string;
}

/** Closed result of publishing or suppressing one terminal result notification. */
export enum ConversationToolResultNotificationOutcomes
{
	/** The exact participant-visible entry and its private receipt are durable. */
	Published = "published",
	/** Current turn, result, lease, or conversation authority no longer permits a new append. */
	NoLongerVisible = "no_longer_visible",
}

/** Reads only the current safe facts needed to build a participant log. */
export interface ConversationToolResultNotificationEvidenceReader
{
	/** Return exact current evidence, or null when a fresh append is no longer authorized. */
	readCurrent(command: ConversationToolResultNotificationCommand): Promise<ConversationToolResultNotificationEvidence | null>;
}

/** Server-owned participant-history effect called before the final model reservation. */
export interface ConversationToolResultNotificationPort
{
	/** Publish or recover the exact terminal result entry without exposing result content. */
	publishTerminal(command: ConversationToolResultNotificationCommand): Promise<ConversationToolResultNotificationOutcomes>;
}
