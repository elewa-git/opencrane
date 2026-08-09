/** Storybook index entry fields used to discover canonical visual states. */
export interface StorybookIndexEntry
{
	/** Stable Component Story Format identifier used by the iframe route. */
	id: string;
	/** Entry kind; only rendered stories participate in screenshot coverage. */
	type: string;
	/** Story tags emitted into the static Storybook index. */
	tags?: readonly string[];
}

/** Minimal Storybook index payload consumed by visual regression discovery. */
export interface StorybookIndex
{
	/** Static catalogue entries keyed by stable story identifier. */
	entries: Readonly<Record<string, StorybookIndexEntry>>;
}
