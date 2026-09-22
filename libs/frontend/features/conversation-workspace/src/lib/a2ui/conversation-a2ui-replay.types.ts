import type { DataModelUpdate } from "@a2ui/web_core/v0_8";
import type { A2UIEntry, ConversationA2uiComponent } from "@opencrane/contracts";

/** Mutable reconstruction owned by one synchronous projection, never shared with the renderer. */
export interface ConversationA2uiFrame
{
	/** Latest component definition for each id since Replace. */
	readonly components: Map<string, ConversationA2uiComponent>;
	/** Ordered data replacements retained for the installed SDK's path semantics. */
	readonly data: DataModelUpdate[];
	/** Null until beginRendering supplies a root. */
	root: string | null;
	/** Cumulative encoded payload size since Replace. */
	bytes: number;
	/** Cumulative protocol operations since Replace. */
	messages: number;
}

/** Latest history coordinate and replay state for one conversation, author and display. */
export interface ConversationA2uiReplay
{
	/** Determines transcript position and the saved author label. */
	readonly entry: A2UIEntry;
	/** Null after an invalid update; removal deletes this record and Patch cannot recreate it. */
	readonly frame: ConversationA2uiFrame | null;
}
