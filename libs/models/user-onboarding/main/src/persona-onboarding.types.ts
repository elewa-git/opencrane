/**
 * Which stage of persona onboarding the user is at. The shell renders one component per stage.
 *
 * The stages run in order: `Interview` → `Resolution` when scoring tied → `Review` → `Ready`.
 * `Resolution` is skipped when there is no tie. These values cross the API boundary, so changing
 * their string values is a breaking contract change.
 */
export enum PersonaOnboardingStates
{
	/** The reviewed interview still needs answers or completion. */
	Interview = "interview",
	/** One scoring tie needs an explicit owner choice. */
	Resolution = "resolution",
	/** Scoring evidence is ready; the caller prepares a draft when no persona revision exists, then offers approval. */
	Review = "review",
	/** A persona is approved and active; onboarding moves on to the first chat. */
	Ready = "ready"
}

/**
 * The kinds of scoring tie the user may be asked to break.
 *
 * More than one can occur in sequence: breaking the primary tie can reveal a secondary one, so the
 * browser reloads until `resolution` is absent. These strings cross the API boundary and the parser
 * rejects values outside this closed set.
 */
export enum PersonaResolutionKinds
{
	/** The owner must choose which tied colour leads the persona. */
	Primary = "primary",
	/** The owner must choose which tied colour supplies the secondary influence. */
	Secondary = "secondary",
	/** The owner must choose between the Explorer and Guardian working styles. */
	Modifier = "modifier"
}

/**
 * The four collaboration colours produced by persona scoring.
 *
 * The scorer stores these strings in evidence and the API sends them to the browser. Unknown values
 * are rejected rather than mapped to a visual fallback.
 */
export enum PersonaColours
{
	/** The persona is direct and decisive when red leads. */
	Red = "red",
	/** The persona is energetic and exploratory when yellow leads. */
	Yellow = "yellow",
	/** The persona is calm and supportive when green leads. */
	Green = "green",
	/** The persona is precise and evidence-led when blue leads. */
	Blue = "blue"
}

/**
 * The two working styles that complete a persona template selection.
 *
 * The scorer stores one of these strings with the colour result. The API and browser treat the set
 * as closed because each value selects a reviewed persona template.
 */
export enum PersonaModifiers
{
	/** The persona prefers novel approaches and creative alternatives. */
	Explorer = "explorer",
	/** The persona prefers proven approaches and bounded risk. */
	Guardian = "guardian"
}

/**
 * Describes an answer the persona authority will accept for a reviewed question. The identifier is
 * sent back by answer commands, while the label and ordinal are presentation data from the frozen
 * question set.
 */
export interface PersonaQuestionChoice
{
	/** Stable choice identifier accepted by the server. */
	readonly id: string;
	/** Human-readable preference shown to the owner. */
	readonly label: string;
	/** One-based stable order within the question. */
	readonly ordinal: number;
}

/**
 * Describes a reviewed interview question and the choice already saved for it, when one exists.
 * Screens render this projection as supplied and send a listed choice identifier rather than
 * inventing or rescoring an answer.
 */
export interface PersonaQuestion
{
	/** Stable question identifier from the frozen question set. */
	readonly id: string;
	/** Preference category used to group the question for display. */
	readonly category: string;
	/** Human-readable preference question. */
	readonly prompt: string;
	/** One-based stable order within the interview. */
	readonly ordinal: number;
	/** The reviewed answers available for this question. */
	readonly choices: readonly PersonaQuestionChoice[];
	/** Already-recorded choice, or null while the question is unanswered. */
	readonly selectedChoiceId: string | null;
}

/**
 * Describes a scoring tie that blocks draft preparation until the owner chooses a listed candidate.
 * The candidate kind determines whether values are persona colours or working-style modifiers, and
 * the runtime validator rejects a mixed set.
 */
export interface PersonaResolution
{
	/** Which scoring dimension is tied. */
	readonly kind: PersonaResolutionKinds;
	/** Values the server will accept for this tie. */
	readonly candidates: readonly (PersonaColours | PersonaModifiers)[];
}

/**
 * Carries the colour counters produced by server-owned scoring. The browser may convert them to
 * display percentages, but it keeps these lossless values so ordering and ties are not recomputed
 * from rounded presentation data.
 */
export interface PersonaColourScores
{
	/** Red collaboration points. */
	readonly red: number;
	/** Yellow collaboration points. */
	readonly yellow: number;
	/** Green collaboration points. */
	readonly green: number;
	/** Blue collaboration points. */
	readonly blue: number;
	/** Sum of all four colour counters. */
	readonly total: number;
}

/**
 * Carries the Explorer and Guardian counters produced by server-owned scoring. The validator checks
 * that `total` equals their sum before the browser uses them to explain the selected modifier.
 */
export interface PersonaOpennessScores
{
	/** Explorer working-style points. */
	readonly explorer: number;
	/** Guardian working-style points. */
	readonly guardian: number;
	/** Sum of the Explorer and Guardian counters. */
	readonly total: number;
}

/**
 * The persona the server worked out, as shown during review and after approval.
 *
 * The browser presents these server-computed values without rescoring the answers. Score fields are
 * raw counters rather than percentages. `instructionPreview` remains null during the pre-draft
 * `Review` state and becomes the material the owner confirms once a revision exists.
 */
export interface PersonaResult
{
	/** Reviewed display name of the selected persona template. */
	readonly displayName: string;
	/** Highest resolved colour score. */
	readonly primaryColour: PersonaColours;
	/** Highest resolved remaining colour score. */
	readonly secondaryColour: PersonaColours;
	/** Resolved Explorer or Guardian template modifier. */
	readonly modifier: PersonaModifiers;
	/** All four colour point counts. */
	readonly colourScores: PersonaColourScores;
	/** Complete openness score vector. */
	readonly opennessScores: PersonaOpennessScores;
	/** Server-derived, answer-linked review explanations. */
	readonly insights: readonly string[];
	/** Instruction text the owner approves, or null before the draft exists. */
	readonly instructionPreview: string | null;
}

/**
 * The user's complete persona-onboarding projection from `GET /me/persona`.
 *
 * `state` tells callers which nullable evidence is available: `Resolution` requires a tie,
 * `Review` requires a scoring result but may still need draft preparation, and `Ready` requires the
 * approved persona revision. Nothing in this projection is computed in the browser; each response
 * replaces the previous snapshot after model-owned runtime validation.
 */
export interface PersonaOnboardingSnapshot
{
	/** Current durable lifecycle stage. */
	readonly state: PersonaOnboardingStates;
	/** Active or completed interview identifier, when present. */
	readonly interviewId: string | null;
	/** Number of answers the server has saved. */
	readonly answeredQuestionCount: number;
	/** Count of reviewed questions pinned to the interview. */
	readonly questionCount: number;
	/** Draft or approved persona revision, when present. */
	readonly personaRevisionId: string | null;
	/** Frozen interview questions and their recorded choices. */
	readonly questions: readonly PersonaQuestion[];
	/** Tie the owner must break, or null when scoring has no unresolved tie. */
	readonly resolution: PersonaResolution | null;
	/** Server-derived result available for review and after approval. */
	readonly result: PersonaResult | null;
}
