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
