import type { GroupChildView } from "@opencrane/models/conversations";
import type { ConversationStatusPresentation } from "@opencrane/elements/conversation";
import type { ConversationGroupSource } from "@opencrane/state/conversation/workspace";
import type { ConversationMessageView } from "../conversation-workspace-feature.types";

/** Display-safe stream state and its available reconnect interaction. */
export interface ConversationWorkspaceConnectionPresentation
{
	/** Copy and tone for the current stream phase. */
	readonly status: ConversationStatusPresentation;
	/** Whether the participant may request a replacement connection. */
	readonly reconnectAvailable: boolean;
}

/** Renders a message with the group actions admitted by its feature mapper. */
export interface ConversationWorkspaceTranscriptEntry extends ConversationMessageView
{
	/** Eligible own group message, or null when no assistant request is offered. */
	readonly requestSource: ConversationGroupSource | null;
	/** Completed child response, or null when sharing is unavailable. */
	readonly shareSource: ConversationGroupSource | null;
	/** Authorized child requests originating from this message. */
	readonly children: readonly GroupChildView[];
}
