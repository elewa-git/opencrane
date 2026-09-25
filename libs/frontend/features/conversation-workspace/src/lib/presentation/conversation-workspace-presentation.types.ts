import type { GroupChildView } from "@opencrane/models/conversations";
import type { ConversationStatusPresentation } from "@opencrane/elements/conversation";
import type { ConversationGroupSource } from "@opencrane/state/conversation/workspace";
import type { ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { ConversationMessageView } from "../conversation-workspace-feature.types";
import type { ConversationA2uiDisplayPresentation } from "../a2ui/conversation-a2ui-display.types";

/** Selects the finite row anatomy rendered in the selected conversation transcript. */
export enum ConversationWorkspaceTranscriptEntryKinds
{
	/** A participant or Agent message with optional group actions. */
	Message = "message",
	/** A server-attested tool lifecycle fact with no participant action. */
	ToolActivity = "tool-activity",
	/** The latest read-only A2UI display, without message or action authority. */
	A2uiDisplay = "a2ui-display"
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
	/** File cards derived from artifact blocks in this message. */
	readonly attachments: readonly ConversationAssetPresentation[];
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

/** Renders a reconstructed display or its fixed waiting/unavailable state. */
export interface ConversationWorkspaceTranscriptA2uiEntry
{
	/** Selects the action-free structured display host. */
	readonly kind: ConversationWorkspaceTranscriptEntryKinds.A2uiDisplay;
	/** Latest saved entry id for this author and display. */
	readonly id: string;
	/** Read-only snapshot with no raw payload or unbound data. */
	readonly display: ConversationA2uiDisplayPresentation;
}

/** Ordered, display-safe rows accepted by the selected conversation transcript. */
export type ConversationWorkspaceTranscriptEntry = ConversationWorkspaceTranscriptMessageEntry | ConversationWorkspaceTranscriptToolEntry | ConversationWorkspaceTranscriptA2uiEntry;
