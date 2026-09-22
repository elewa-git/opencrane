import type { ConversationA2uiDisplay } from "./conversation-a2ui.types";

/** Contains the strict final JSON answer requested by CompiledFinalOutputModes.Conversation. */
export interface ConversationFinalOutput
{
	/** Preserves nonblank ordinary text, including whitespace, as the answer and display fallback. */
	readonly text: string;
	/** Optionally supplies a complete static display; absence means the answer contains ordinary text only. */
	readonly display?: ConversationA2uiDisplay;
}
