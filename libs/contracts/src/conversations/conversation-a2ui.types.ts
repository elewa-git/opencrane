/**
 * A literal text value or a data binding in the read-only A2UI 0.8 catalogue.
 * History consumers support bindings; newly generated conversation answers permit literals only.
 * @see https://a2ui.org/specification/v0.8-a2ui/ — the pinned wire protocol.
 */
export type ConversationA2uiTextValue = {
	/** Supplies text without giving it HTML or action semantics. */
	readonly literalString: string;
} | {
	/** Selects data already admitted by the history consumer; producers cannot introduce bindings. */
	readonly path: string;
};

/** Supplies finite layout choices from the standard A2UI 0.8 catalogue. */
export interface ConversationA2uiLayout
{
	/** Lists component identifiers; templates and implicit expansion are not accepted. */
	readonly children: {
		/** Preserves the display order of the referenced components. */
		readonly explicitList: string[];
	};
	/** Distributes children using renderer-owned styles. */
	readonly distribution?: "start" | "center" | "end" | "spaceBetween" | "spaceAround" | "spaceEvenly";
	/** Aligns children using renderer-owned styles. */
	readonly alignment?: "start" | "center" | "end" | "stretch";
}

/**
 * Defines a component in the shared read-only subset, without depending on a renderer SDK.
 * The paired validator requires exactly one component key and rejects actions, media and styles.
 * @see https://a2ui.org/specification/v0.8-a2ui/ — component definitions and explicit child lists.
 */
export interface ConversationA2uiComponent
{
	/** Identifies a component within its enclosing display. */
	readonly id: string;
	/** Supplies a positive relative layout weight, bounded by the shared validator. */
	readonly weight?: number;
	/** Contains exactly one supported component definition. */
	readonly component: {
		/** Displays literal text or a consumer-resolved data binding. */
		readonly Text?: {
			/** Supplies the text source; newly generated answers must use a literal. */
			readonly text: ConversationA2uiTextValue;
			/** Selects a standard text role without arbitrary styles. */
			readonly usageHint?: "h1" | "h2" | "h3" | "h4" | "h5" | "caption" | "body";
		};
		/** Places explicit children horizontally. */
		readonly Row?: ConversationA2uiLayout;
		/** Places explicit children vertically. */
		readonly Column?: ConversationA2uiLayout;
		/** Surrounds one referenced component with a static card. */
		readonly Card?: {
			/** Identifies the component inside the card. */
			readonly child: string;
		};
		/** Draws a horizontal separator using renderer-owned styling. */
		readonly Divider?: {
			/** Horizontal is the only accepted direction. */
			readonly axis?: "horizontal";
		};
	};
}

/** Supplies component definitions for an A2UI 0.8 surfaceUpdate operation. */
export interface ConversationA2uiSurfaceUpdate
{
	/** Binds the operation to its enclosing display; generated answers use the reserved placeholder. */
	readonly surfaceId: string;
	/** Contains definitions whose references the conversation owner must check before publication. */
	readonly components: ConversationA2uiComponent[];
}

/** Selects the root of an A2UI 0.8 beginRendering operation. */
export interface ConversationA2uiBeginRendering
{
	/** Binds the operation to its enclosing display; it never grants permission to replace another. */
	readonly surfaceId: string;
	/** Identifies the root component to render after definitions have been supplied. */
	readonly root: string;
	/** May identify the standard catalogue; it is never a URL for the browser to fetch. */
	readonly catalogId?: string;
}

/**
 * Contains a complete generated display: definitions followed by the root selection.
 * Both operations use CONVERSATION_A2UI_SURFACE_PLACEHOLDER until the conversation owner validates
 * graph completeness and substitutes its own display identifier. Shape validation grants no write authority.
 */
export type ConversationA2uiDisplay = [
	{
		/** Defines all components needed by this answer; only literal text is accepted. */
		readonly surfaceUpdate: ConversationA2uiSurfaceUpdate;
	},
	{
		/** Selects the root from the definitions in the preceding operation. */
		readonly beginRendering: ConversationA2uiBeginRendering;
	},
];
