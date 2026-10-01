/**
 * Finite guidance states shown before a browser tab can use the current Tier 2 launch.
 *
 * String values cross the browser sessionStorage boundary. Changing a persisted value requires the
 * storage reader and writer to change together so an obsolete tab cannot fall back to fresh entry.
 */
export enum Tier2DevelopmentSessionGuidanceStates
{
	/** Fresh entry with no stored guidance; permits the current-launch handoff in this same tab. */
	Missing = "missing",

	/** SessionStorage-backed terminal state for an old tab whose earlier launch was replaced. */
	Replaced = "replaced"
}

/** Replaces the current document after a Tier 2 session is invalidated. */
export type Tier2DevelopmentSessionDocumentReplacer = (url: string) => void;
