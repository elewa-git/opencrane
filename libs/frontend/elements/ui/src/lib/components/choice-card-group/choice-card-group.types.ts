/** One finite option rendered by the shared choice-card group. */
export interface ChoiceCardOption
{
	/** Stable value emitted when the option is chosen. */
	readonly id: string;
	/** Primary user-facing label. */
	readonly label: string;
	/** Optional explanation that helps distinguish similar choices. */
	readonly description?: string;
	/** Whether this individual option is unavailable. */
	readonly disabled?: boolean;
}

/** Supported arrangements for the choice-card collection. */
export enum ChoiceCardLayouts
{
	/** One option per row for questions with longer copy. */
	Stack = "stack",
	/** Responsive two-column arrangement for concise options. */
	Grid = "grid"
}

/**
 * Sets a choice legend's visual priority relative to the page around it.
 *
 * {@link ChoiceCardGroupComponent} reads this memory-only value to select a CSS modifier. The value
 * is not persisted or sent over an API, and typed callers must use one of the two states below.
 */
export enum ChoiceCardPromptEmphases
{
	/** The page heading remains stronger than this ordinary form legend. */
	Standard = "standard",
	/** The current task legend becomes the strongest heading inside its journey. */
	Primary = "primary"
}
