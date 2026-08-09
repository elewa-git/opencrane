/** Stable colour dimensions used by the reviewed sorting policy. */
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

/** Stable working-style modifiers used by the reviewed sorting policy. */
export enum PersonaModifierValues
{
	/** Prefers novel and creative approaches. */
	Explorer = "explorer",
	/** Prefers proven and predictable approaches. */
	Guardian = "guardian",
}

/** Governed tie boundaries that may require an explicit owner choice. */
export enum PersonaTieKinds
{
	/** Highest colour counter. */
	Primary = "primary",
	/** Highest remaining colour counter. */
	Secondary = "secondary",
	/** Explorer versus Guardian counter. */
	Modifier = "modifier",
}

/** Exact colour or modifier value that may participate in a governed persona selection. */
export type PersonaSelectionValue = PersonaColourValues | PersonaModifierValues;

/** One persisted answer joined to its exact reviewed scoring weight. */
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

/** Append-only user resolution for one exact tie candidate set. */
export interface PersonaTieChoice
{
	/** Boundary being resolved. */
	readonly kind: PersonaTieKinds;
	/** Exact candidates shown to the owner. */
	readonly candidates: readonly PersonaSelectionValue[];
	/** Candidate explicitly selected by the owner. */
	readonly selectedValue: PersonaSelectionValue;
}

/** Lossless raw colour vector. */
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

/** Lossless raw Explorer/Guardian vector. */
export interface PersonaOpennessScores
{
	/** Explorer counter. */
	readonly explorer: number;
	/** Guardian counter. */
	readonly guardian: number;
	/** Sum of both modifier counters. */
	readonly total: number;
}

/** One unresolved governed selection boundary. */
export interface PersonaResolutionRequired
{
	/** Boundary requiring the user's choice. */
	readonly kind: PersonaTieKinds;
	/** Exact tied candidates, in stable product order. */
	readonly candidates: readonly PersonaSelectionValue[];
}

/** Ordered candidate evidence derived by the authoritative persona scoring policy. */
export interface PersonaScoreCandidateEvidence
{
	/** Highest colour candidates in stable product order. */
	readonly primary: readonly PersonaColourValues[];
	/** Highest remaining colour candidates, or an empty vector until primary is resolved. */
	readonly secondary: readonly PersonaColourValues[];
	/** Modifier candidates, or an empty vector until both colour boundaries are resolved. */
	readonly modifier: readonly PersonaModifierValues[];
}

/** Immutable inputs required to replay a previously persisted persona score. */
export interface PersonaScoreReplayEvidence
{
	/** Ordered immutable answer identities used in the original calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** Ordered exact question and choice coordinates used in the original calculation. */
	readonly orderedChoiceIds: readonly string[];
	/** Authoritative raw colour counters. */
	readonly colours: PersonaColourScores;
	/** Authoritative raw modifier counters. */
	readonly openness: PersonaOpennessScores;
	/** Exact append-only tie resolutions admitted before drafting. */
	readonly tieResolutions: readonly PersonaTieChoice[];
}

/** Fully scored result, with a stable next resolution when still ambiguous. */
export interface PersonaScoreResult
{
	/** Ordered immutable answer identities used in the calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** Ordered exact question/choice coordinates used in the calculation. */
	readonly orderedChoiceIds: readonly string[];
	/** Authoritative raw colour vector. */
	readonly colours: PersonaColourScores;
	/** Authoritative raw modifier vector. */
	readonly openness: PersonaOpennessScores;
	/** Exact append-only tie choices admitted while replaying this score. */
	readonly tieResolutions: readonly PersonaTieChoice[];
	/** Resolved primary colour, or null until its tie is resolved. */
	readonly primary: PersonaColourValues | null;
	/** Resolved secondary colour, or null until its tie is resolved. */
	readonly secondary: PersonaColourValues | null;
	/** Resolved working-style modifier, or null until its tie is resolved. */
	readonly modifier: PersonaModifierValues | null;
	/** Stable next tie boundary; null means drafting may proceed. */
	readonly resolutionRequired: PersonaResolutionRequired | null;
}

/** Scorer-owned result carrying the ordered evidence that persistence may store but never derive. */
export interface PersonaAuthoritativeScoreResult extends PersonaScoreResult
{
	/** Ordered candidates reached while replaying the score's current append-only tie evidence. */
	readonly candidateEvidence: PersonaScoreCandidateEvidence;
}

/** Exact resolved score evidence serialized into one immutable persona revision. */
export interface PersonaPersistedScoreEvidence
{
	/** Ordered immutable answer identities used in the calculation. */
	readonly orderedAnswerIds: readonly string[];
	/** Ordered exact question and choice coordinates used in the calculation. */
	readonly orderedChoiceIds: readonly string[];
	/** Authoritative raw colour counters. */
	readonly colours: PersonaColourScores;
	/** Authoritative raw modifier counters. */
	readonly openness: PersonaOpennessScores;
	/** Exact append-only tie resolutions admitted before drafting. */
	readonly tieResolutions: readonly PersonaTieChoice[];
	/** Resolved primary colour. */
	readonly primary: PersonaColourValues;
	/** Resolved secondary colour. */
	readonly secondary: PersonaColourValues;
	/** Resolved working-style modifier. */
	readonly modifier: PersonaModifierValues;
}
