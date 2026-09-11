import type { GroupChildView } from "@opencrane/models/conversations";
import type { ConversationStatusPresentation } from "@opencrane/elements/conversation";
import type { ConversationGroupSource } from "@opencrane/state/conversation/workspace";
import type { ConversationMessageView } from "../conversation-workspace-feature.types";

/** Selects the finite row anatomy rendered in the selected conversation transcript. */
export enum ConversationWorkspaceTranscriptEntryKinds
{
	/** A participant or Agent message with optional group actions. */
	Message = "message",
	/** A server-attested tool lifecycle fact with no participant action. */
	ToolActivity = "tool-activity"
}

/** Display-safe stream state and its available reconnect interaction. */
export interface ConversationWorkspaceConnectionPresentation
{
	/** Copy and tone for the current stream phase. */
	readonly status: ConversationStatusPresentation;
	/** Whether the participant may request a replacement connection. */
	readonly reconnectAvailable: boolean;
}

/** Renders a message with the group actions admitted by its feature mapper. */
export interface ConversationWorkspaceTranscriptMessageEntry extends ConversationMessageView
{
	/** Selects the message row anatomy. */
	readonly kind: ConversationWorkspaceTranscriptEntryKinds.Message;
	/** Stable history entry key used only for Angular tracking. */
	readonly id: string;
	/** Eligible own group message, or null when no assistant request is offered. */
	readonly requestSource: ConversationGroupSource | null;
	/** Completed child response, or null when sharing is unavailable. */
	readonly shareSource: ConversationGroupSource | null;
	/** Authorized child requests originating from this message. */
	readonly children: readonly GroupChildView[];
}

/** Renders one latest canonical tool lifecycle fact without exposing its coordinates or payload. */
export interface ConversationWorkspaceTranscriptToolEntry
{
	/** Selects the status-row anatomy. */
	readonly kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity;
	/** Stable history entry key used only for Angular tracking. */
	readonly id: string;
	/** Plain participant-facing lifecycle presentation. */
	readonly status: ConversationStatusPresentation;
}

/** Ordered, display-safe rows accepted by the selected conversation transcript. */
export type ConversationWorkspaceTranscriptEntry = ConversationWorkspaceTranscriptMessageEntry | ConversationWorkspaceTranscriptToolEntry;
