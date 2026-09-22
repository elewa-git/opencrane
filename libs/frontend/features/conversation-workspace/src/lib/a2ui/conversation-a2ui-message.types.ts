import type { BeginRenderingMessage, ComponentProperties, DataModelUpdate, ValueMap } from "@a2ui/web_core/v0_8";

/** The supported subset of the installed v0.8 catalogue; the paired validator rejects extensions. */
export interface ConversationA2uiComponent
{
	/** Identifies a component within one display. */
	readonly id: string;
	/** Optional relative layout weight, limited by the browser display policy. */
	readonly weight?: number;
	/** Exactly one supported component definition is permitted. */
	readonly component: {
		/** Escaped text or a binding resolved before the renderer receives it. */
		readonly Text?: ComponentProperties["Text"];
		/** A row with an explicit list of children; templates are not admitted. */
		readonly Row?: ComponentProperties["Row"];
		/** A column with an explicit list of children; templates are not admitted. */
		readonly Column?: ComponentProperties["Column"];
		/** A static card around another component. */
		readonly Card?: ComponentProperties["Card"];
		/** A horizontal separator without agent-supplied colours or dimensions. */
		readonly Divider?: ComponentProperties["Divider"];
	};
}

/** One official v0.8 operation in a JSON-array history payload; exactly one field is allowed. */
export interface ConversationA2uiMessage
{
	/** Supplies the root and optional standard catalogue identifier; arbitrary styles are refused. */
	readonly beginRendering?: Pick<BeginRenderingMessage, "surfaceId" | "root" | "catalogId">;
	/** Adds or replaces component definitions within this display. */
	readonly surfaceUpdate?: {
		/** Must match the surrounding conversation entry. */
		readonly surfaceId: string;
		/** Definitions admitted by the read-only component validator. */
		readonly components: ConversationA2uiComponent[];
	};
	/** Replaces data at the supplied path using the official typed map representation. */
	readonly dataModelUpdate?: DataModelUpdate;
	/** Removes the display; it cannot select another entry's display. */
	readonly deleteSurface?: { readonly surfaceId: string };
}

/** Shared alias keeps recursive map validation tied to the installed SDK's wire model. */
export type ConversationA2uiValueMap = ValueMap;
