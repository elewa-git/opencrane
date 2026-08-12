import type { ConversationMessage, ConversationSummary } from "@opencrane/state/conversation/workspace";

/** Generic privacy-safe list row shown in the workspace rail. */
export interface ConversationSummaryPresentation
{
	/** Stable conversation coordinate used for selection. */
	readonly id: string;
	/** Generic or server-approved title. */
	readonly title: string;
	/** Plain immutable-mode label. */
	readonly modeLabel: string;
	/** Plain participant-count detail. */
	readonly participantLabel: string;
	/** Preformatted update time. */
	readonly updatedLabel: string;
	/** Whether this participant archived the row. */
	readonly archived: boolean;
}

/** Full display-safe presentation for one canonical transcript row. */
export interface ConversationMessageView
{
	/** Shared message element presentation. */
	readonly message: import("@opencrane/elements/conversation").ConversationMessagePresentation;
	/** Sanitized rich-text projection rendered inside the shared rich-card slot. */
	readonly richText: import("@opencrane/elements/conversation").ConversationRichTextPresentation;
	/** Child route coordinates when this message invoked an Agent. */
	readonly agentThread: ConversationMessage["agentThread"];
}

/** Route intent for opening one child Agent session from its parent message. */
export interface ConversationThreadNavigationIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Child Agent-session coordinate. */
	readonly childConversationId: string;
	/** Parent root-message coordinate restored on return. */
	readonly parentMessageId: string;
}

/** Inputs needed to map generic labels without interpreting opaque references. */
export interface ConversationPresentationContext
{
	/** Current privacy-safe creation directory. */
	readonly directory: import("@opencrane/state/conversation/workspace").ConversationCreationDirectory | null;
	/** Selected summary carrying immutable mode and participant count. */
	readonly summary: ConversationSummary;
}

/** Explicit workspace availability copy derived from the existing privacy-safe directory. */
export interface ConversationWorkspaceAvailabilityPresentation
{
	/** Short state heading. */
	readonly heading: string;
	/** Plain explanation that does not disclose hidden identities. */
	readonly detail: string;
}
