/**
 * How wide the content column is inside the journey shell.
 *
 * Pick by content, not by screen: the compact layout suits a single conversation or form, the wide
 * one suits a review screen with tables or score bars. The shell handles the responsive behaviour
 * either way.
 */
export enum JourneyShellLayouts
{
	/** Focused entry or single-question journey. */
	Compact = "compact",
	/** Result or conversation composition that needs more horizontal room. */
	Wide = "wide"
}

/**
 * How strongly the shared journey heading should compete with the task inside the shell.
 *
 * Width and hierarchy are independent: a wide review can still need a display heading, while a
 * wide single-question interview should keep the reviewed question as the strongest visual cue.
 * {@link JourneyShellComponent} reads this memory-only value to select a CSS modifier. It is not
 * persisted or sent over an API, and typed callers must use one of the two states below.
 */
export enum JourneyShellHeaderEmphases
{
	/** The journey title introduces a major state at the full display scale. */
	Display = "display",
	/** The journey title stays visible while the current task receives stronger emphasis. */
	Supporting = "supporting"
}
