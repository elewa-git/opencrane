import type { PersonaColours, PersonaColourScores, PersonaModifiers, PersonaOpennessScores, PersonaResolutionKinds } from "@opencrane/state/onboarding";

/** One reviewed scoring row pinned by the version-one target baseline. */
export interface _LocalDevelopmentScoringWeight
{
	/** Red contribution. */
	readonly red: number;
	/** Yellow contribution. */
	readonly yellow: number;
	/** Green contribution. */
	readonly green: number;
	/** Blue contribution. */
	readonly blue: number;
	/** Explorer contribution. */
	readonly explorer: number;
	/** Guardian contribution. */
	readonly guardian: number;
}

/** Colour or working-style selection accepted at a current scoring tie. */
export type _LocalDevelopmentScoreSelection = PersonaColours | PersonaModifiers;

/** Owner choice retained while the local scorer advances through ordered ties. */
export interface _LocalDevelopmentTieChoice
{
	/** Tie boundary the owner resolved. */
	readonly kind: PersonaResolutionKinds;
	/** Candidate selected from the exact presented set. */
	readonly selectedValue: _LocalDevelopmentScoreSelection;
}

/** Current score and its next unresolved tie. */
export interface _LocalDevelopmentScore
{
	/** Raw colour totals from all ten reviewed answers. */
	readonly colours: PersonaColourScores;
	/** Raw working-style totals from the reviewed openness answers. */
	readonly openness: PersonaOpennessScores;
	/** Selected primary colour, or null until its tie is resolved. */
	readonly primary: PersonaColours | null;
	/** Selected secondary colour, or null until its tie is resolved. */
	readonly secondary: PersonaColours | null;
	/** Selected working style, or null until its tie is resolved. */
	readonly modifier: PersonaModifiers | null;
	/** Next tie the owner must resolve, or null when scoring is complete. */
	readonly resolution: { readonly kind: PersonaResolutionKinds; readonly candidates: readonly _LocalDevelopmentScoreSelection[] } | null;
}
