/** The four persona colours the scoring policy counts. */
export enum PersonaColourValues
{
	/** Fast, decisive collaboration. */
	Red = "red",
	/** Energetic, exploratory collaboration. */
	Yellow = "yellow",
	/** Calm, supportive collaboration. */
	Green = "green",
	/** Precise, evidence-led collaboration. */
	Blue = "blue",
}

/** The two working-style modifiers the scoring policy counts. */
export enum PersonaModifierValues
{
	/** Prefers novel and creative approaches. */
	Explorer = "explorer",
	/** Prefers proven and predictable approaches. */
	Guardian = "guardian",
}

/** The three points in scoring where two candidates can tie and the owner has to choose. */
export enum PersonaTieKinds
{
	/** Tie for the highest colour counter. */
	Primary = "primary",
	/** Tie for the highest colour counter left after the primary colour is taken out. */
	Secondary = "secondary",
	/** Tie between the Explorer and Guardian counters. */
	Modifier = "modifier",
}

/** Any value the owner can be asked to choose between: a colour or a modifier. */
export type PersonaSelectionValue = PersonaColourValues | PersonaModifierValues;

/** One stored answer together with the scoring weights of the choice it selected. */
export interface PersonaWeightedAnswer
{
	/** Durable answer identity. */
	readonly answerId: string;
	/** Stable question identity. */
	readonly questionId: string;
	/** Exact reviewed choice identity. */
	readonly choiceId: string;
	/** Red counter contribution. */
	readonly red: number;
	/** Yellow counter contribution. */
	readonly yellow: number;
	/** Green counter contribution. */
	readonly green: number;
	/** Blue counter contribution. */
	readonly blue: number;
	/** Explorer counter contribution. */
	readonly explorer: number;
	/** Guardian counter contribution. */
	readonly guardian: number;
}

/** The owner's choice for one tie. Once written it is never changed. */
export interface PersonaTieChoice
{
	/** Which tie this choice settles. */
	readonly kind: PersonaTieKinds;
	/** Exact candidates shown to the owner. */
	readonly candidates: readonly PersonaSelectionValue[];
	/** Candidate explicitly selected by the owner. */
	readonly selectedValue: PersonaSelectionValue;
}

/** The four raw colour counters and their sum, kept as whole numbers. */
export interface PersonaColourScores
{
	/** Red counter. */
	readonly red: number;
	/** Yellow counter. */
	readonly yellow: number;
	/** Green counter. */
	readonly green: number;
	/** Blue counter. */
	readonly blue: number;
	/** Sum of all colour counters. */
	readonly total: number;
}

/** The raw Explorer and Guardian counters and their sum, kept as whole numbers. */
export interface PersonaOpennessScores
{
	/** Explorer counter. */
	readonly explorer: number;
	/** Guardian counter. */
	readonly guardian: number;
	/** Sum of both modifier counters. */
	readonly total: number;
}

/** One tie the owner still has to break. */
export interface PersonaResolutionRequired
{
	/** Which tie needs the owner's choice. */
	readonly kind: PersonaTieKinds;
	/** The tied candidates, in a fixed display order. */
	readonly candidates: readonly PersonaSelectionValue[];
}

/** The candidate list the scorer reached at each of the three ties, in order. */
export interface PersonaScoreCandidateEvidence
{
	/** Highest colour candidates in stable product order. */
	readonly primary: readonly PersonaColourValues[];
	/** The highest colours left after the primary colour, or an empty list until the primary colour is chosen. */
	readonly secondary: readonly PersonaColourValues[];
	/** The modifier candidates, or an empty list until both colours are chosen. */
	readonly modifier: readonly PersonaModifierValues[];
}

/** The stored inputs needed to recompute a persona score exactly as it was first computed. */
export interface PersonaScoreReplayEvidence
{
	/** Ordered immutable answer identities used in the original calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** `questionId:choiceId` pairs, in the order the first calculation used them. */
	readonly orderedChoiceIds: readonly string[];
	/** Authoritative raw colour counters. */
	readonly colours: PersonaColourScores;
	/** Authoritative raw modifier counters. */
	readonly openness: PersonaOpennessScores;
	/** The tie choices the owner made before the draft was created. */
	readonly tieResolutions: readonly PersonaTieChoice[];
}

/** A scored result, plus the next tie to break when the outcome is still tied. */
export interface PersonaScoreResult
{
	/** Ordered immutable answer identities used in the calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** `questionId:choiceId` pairs, in the order the calculation used them. */
	readonly orderedChoiceIds: readonly string[];
	/** The colour counters as scored, with their sum. */
	readonly colours: PersonaColourScores;
	/** The Explorer and Guardian counters as scored, with their sum. */
	readonly openness: PersonaOpennessScores;
	/** The tie choices used while recomputing this score. */
	readonly tieResolutions: readonly PersonaTieChoice[];
	/** Resolved primary colour, or null until its tie is resolved. */
	readonly primary: PersonaColourValues | null;
	/** Resolved secondary colour, or null until its tie is resolved. */
	readonly secondary: PersonaColourValues | null;
	/** Resolved working-style modifier, or null until its tie is resolved. */
	readonly modifier: PersonaModifierValues | null;
	/** The next tie the owner must break; null means a draft can be created. */
	readonly resolutionRequired: PersonaResolutionRequired | null;
}

/** A score result plus the candidate list at each tie. Only the scorer works these out; the repository stores them and must never recompute them. */
export interface PersonaAuthoritativeScoreResult extends PersonaScoreResult
{
	/** The candidate list at each tie, in the order scoring reached them. */
	readonly candidateEvidence: PersonaScoreCandidateEvidence;
}

/** The finished score stored as JSON on a persona revision, with every tie already broken. */
export interface PersonaPersistedScoreEvidence
{
	/** Ordered immutable answer identities used in the calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** `questionId:choiceId` pairs, in the order the calculation used them. */
	readonly orderedChoiceIds: readonly string[];
	/** Authoritative raw colour counters. */
	readonly colours: PersonaColourScores;
	/** Authoritative raw modifier counters. */
	readonly openness: PersonaOpennessScores;
	/** The tie choices the owner made before the draft was created. */
	readonly tieResolutions: readonly PersonaTieChoice[];
	/** Resolved primary colour. */
	readonly primary: PersonaColourValues;
	/** Resolved secondary colour. */
	readonly secondary: PersonaColourValues;
	/** Resolved working-style modifier. */
	readonly modifier: PersonaModifierValues;
}
