import type { Surface } from "@a2ui/web_core/v0_8";

/**
 * Selects the read-only structured display in the conversation transcript. These values exist only
 * in browser presentation state; they neither authorise actions nor change saved history.
 */
export enum ConversationA2uiDisplayStates
{
	/** The admitted display is complete and contains only the read-only catalogue. */
	Ready = "ready",
	/** Valid updates have not yet supplied a complete root, children, or text binding. */
	Waiting = "waiting",
	/** The latest history cannot be displayed; a new complete replacement is required. */
	Unavailable = "unavailable",
}

/** Contains resolved display content, never raw messages, commands, or callbacks. */
export interface ConversationA2uiDisplayPresentation
{
	/** Selects content, waiting feedback, or unavailable feedback. */
	readonly state: ConversationA2uiDisplayStates;
	/** The server-stamped author label; it is display text, not an identity key. */
	readonly authorName: string;
	/** Names the display inside its isolated author and conversation scope. */
	readonly surfaceId: string;
	/** The Ready tree with literal text and no retained data model; null for other states. */
	readonly surface: Surface | null;
	/** Fixed feedback copy without an untrusted payload or parser error. */
	readonly detail: string | null;
}
