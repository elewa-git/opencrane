import type { PersonaColours, PersonaColourScores, PersonaModifiers, PersonaOpennessScores, PersonaResolutionKinds } from "@opencrane/state/onboarding";

/** Stores the six contributions from a scoring row in the version-one target baseline. */
export interface _LocalDevelopmentScoringWeight
{
	/** Adds this amount to the red score. */
	readonly red: number;
	/** Adds this amount to the yellow score. */
	readonly yellow: number;
	/** Adds this amount to the green score. */
	readonly green: number;
	/** Adds this amount to the blue score. */
	readonly blue: number;
	/** Adds this amount to the Explorer score. */
	readonly explorer: number;
	/** Adds this amount to the Guardian score. */
	readonly guardian: number;
}

/** Restricts a tie choice to a colour or working style presented by the scorer. */
export type _LocalDevelopmentScoreSelection = PersonaColours | PersonaModifiers;

/** Records an owner choice while the local scorer advances through ordered ties. */
export interface _LocalDevelopmentTieChoice
{
	/** Identifies the tie that the owner resolved. */
	readonly kind: PersonaResolutionKinds;
	/** Keeps the candidate selected from the presented set. */
	readonly selectedValue: _LocalDevelopmentScoreSelection;
}

/** Carries the current score and the next tie that still needs an owner choice. */
export interface _LocalDevelopmentScore
{
	/** Stores colour totals from all ten reviewed answers. */
	readonly colours: PersonaColourScores;
	/** Stores working-style totals from the reviewed openness answers. */
	readonly openness: PersonaOpennessScores;
	/** Holds the selected primary colour, or null until its tie is resolved. */
	readonly primary: PersonaColours | null;
	/** Holds the selected secondary colour, or null until its tie is resolved. */
	readonly secondary: PersonaColours | null;
	/** Holds the selected working style, or null until its tie is resolved. */
	readonly modifier: PersonaModifiers | null;
	/** Holds the next tie the owner must resolve, or null when scoring is complete. */
	readonly resolution: { readonly kind: PersonaResolutionKinds; readonly candidates: readonly _LocalDevelopmentScoreSelection[] } | null;
}
