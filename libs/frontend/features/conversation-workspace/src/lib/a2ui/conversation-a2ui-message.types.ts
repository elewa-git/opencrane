import type { DataModelUpdate, ValueMap } from "@a2ui/web_core/v0_8";
import type { ConversationA2uiBeginRendering, ConversationA2uiSurfaceUpdate } from "@opencrane/contracts";

/** One official v0.8 operation in a JSON-array history payload; exactly one field is allowed. */
export interface ConversationA2uiMessage
{
	/** Supplies the root and optional standard catalogue identifier; arbitrary styles are refused. */
	readonly beginRendering?: ConversationA2uiBeginRendering;
	/** Adds or replaces component definitions within this display. */
	readonly surfaceUpdate?: ConversationA2uiSurfaceUpdate;
	/** Replaces data at the supplied path using the official typed map representation. */
	readonly dataModelUpdate?: DataModelUpdate;
	/** Removes the display; it cannot select another entry's display. */
	readonly deleteSurface?: { readonly surfaceId: string };
}

/** Shared alias keeps recursive map validation tied to the installed SDK's wire model. */
export type ConversationA2uiValueMap = ValueMap;
