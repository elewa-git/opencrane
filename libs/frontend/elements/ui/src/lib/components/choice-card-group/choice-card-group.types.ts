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
