import { InjectionToken } from "@angular/core";

/**
 * Which stage of persona onboarding the user is at. The shell renders one component per stage.
 *
 * They run in order: `Interview` → `Resolution` (only when scoring tied) → `Review` → `Ready`.
 * `Resolution` is skipped entirely when there is no tie, so never assume it happens.
 */
export enum PersonaOnboardingStates
{
	/** The reviewed interview still needs answers or completion. */
	Interview = "interview",
	/** One exact scoring tie needs an explicit owner choice. */
	Resolution = "resolution",
	/** An immutable persona draft is available for review and approval. */
	Review = "review",
	/** A persona is approved and active; onboarding moves on to the first chat. */
	Ready = "ready"
}

/**
 * The kinds of scoring tie the user may be asked to break.
 *
 * More than one can occur in sequence: breaking the primary tie can reveal a secondary one, so keep
 * loading until `resolution` is null. `Primary` and `Secondary` offer colours; `Modifier` offers the
 * two working styles.
 */
export enum PersonaResolutionKinds
{
	/** Choose which tied colour leads the persona. */
	Primary = "primary",
	/** Choose which tied colour supplies the secondary influence. */
	Secondary = "secondary",
	/** Choose between the tied Explorer and Guardian working styles. */
	Modifier = "modifier"
}

/** The four collaboration colours the scorer works in. */
export enum PersonaColours
{
	/** Direct and decisive collaboration. */
	Red = "red",
	/** Energetic and exploratory collaboration. */
	Yellow = "yellow",
	/** Calm and supportive collaboration. */
	Green = "green",
	/** Precise and evidence-led collaboration. */
	Blue = "blue"
}

/** The two working styles; together with the colours they pick the persona template. */
export enum PersonaModifiers
{
	/** Prefer novel approaches and creative alternatives. */
	Explorer = "explorer",
	/** Prefer proven approaches and bounded risk. */
	Guardian = "guardian"
}

/** One answer the user can pick for a question. */
export interface PersonaQuestionChoice
{
	/** Stable choice identifier accepted by the server. */
	readonly id: string;
	/** Human-readable preference shown to the owner. */
	readonly label: string;
	/** One-based stable order within the question. */
	readonly ordinal: number;
}

/** One interview question, and the answer already recorded for it if there is one. */
export interface PersonaQuestion
{
	/** Stable question identifier from the frozen question set. */
	readonly id: string;
	/** Which preference category this question belongs to, used to group them for display. */
	readonly category: string;
	/** Human-readable preference question. */
	readonly prompt: string;
	/** One-based stable order within the interview. */
	readonly ordinal: number;
	/** The available answers; always at least two. */
	readonly choices: readonly PersonaQuestionChoice[];
	/** Already-recorded choice, or null while the question is unanswered. */
	readonly selectedChoiceId: string | null;
}

/** A scoring tie the user has to break before onboarding can continue. */
export interface PersonaResolution
{
	/** Which tie this is. */
	readonly kind: PersonaResolutionKinds;
	/** The only values the user may pick; anything else is rejected by the server. */
	readonly candidates: readonly (PersonaColours | PersonaModifiers)[];
}

/** Raw colour point counts from the server's scoring. Divide by `total` for a percentage. */
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
	/** Total points across the four colours; use it as the denominator for percentages. */
	readonly total: number;
}

/** Lossless openness counters retained by the server-owned scoring result. */
export interface PersonaOpennessScores
{
	/** Explorer working-style points. */
	readonly explorer: number;
	/** Guardian working-style points. */
	readonly guardian: number;
	/** Denominator used for display-only openness percentages. */
	readonly total: number;
}

/**
 * The persona the server worked out, as shown on the review screen and after approval.
 *
 * All of it is computed server-side — the scores are raw counts, not percentages, so a UI showing
 * percentages divides by the `total` on each score group. `instructionPreview` is the text the user
 * must approve and is null until the draft exists.
 */
export interface PersonaResult
{
	/** Reviewed display name of the selected template. */
	readonly displayName: string;
	/** Highest resolved colour score. */
	readonly primaryColour: PersonaColours;
	/** Highest resolved remaining colour score. */
	readonly secondaryColour: PersonaColours;
	/** Resolved Explorer or Guardian template modifier. */
	readonly modifier: PersonaModifiers;
	/** All four colour point counts. */
	readonly colourScores: PersonaColourScores;
	/** Complete lossless openness score vector. */
	readonly opennessScores: PersonaOpennessScores;
	/** Up to five server-derived, provenance-linked review explanations. */
	readonly insights: readonly string[];
	/** The instruction text the user approves. Null until the draft exists; never changes once set. */
	readonly instructionPreview: string | null;
}

/**
 * The user's whole persona-onboarding state, from `GET /me/persona`.
 *
 * `state` decides which of the optional fields are filled in, so read it first: `questions` during
 * the interview, `resolution` only when a tie needs breaking, `result` from Review onwards, and
 * `personaRevisionId` once a draft exists. Nothing here is computed in the browser.
 *
 * @see PersonaOnboardingStates
 */
export interface PersonaOnboardingSnapshot
{
	/** Current durable lifecycle stage. */
	readonly state: PersonaOnboardingStates;
	/** Active or completed interview identifier, when present. */
	readonly interviewId: string | null;
	/** How many answers the server has saved. */
	readonly answeredQuestionCount: number;
	/** Count of reviewed questions pinned to the interview. */
	readonly questionCount: number;
	/** Draft or approved immutable persona revision, when present. */
	readonly personaRevisionId: string | null;
	/** The interview's questions, each with the choice already recorded for it, if any. */
	readonly questions: readonly PersonaQuestion[];
	/** The tie the user must break, or null when scoring produced a clear winner. */
	readonly resolution: PersonaResolution | null;
	/** Server-derived result available for review and after approval. */
	readonly result: PersonaResult | null;
}

/**
 * The persona-onboarding calls for the signed-in user.
 *
 * Note the asymmetry: only {@link load} returns anything. Every other call returns void, so the
 * caller must `load()` afterwards to see the result — that is why PersonaOnboardingService pairs
 * each command with a read rather than trusting a return value.
 *
 * The workflow runs in a fixed order: interview → any scoring ties → draft → approve. Calling a step
 * out of order fails at the server.
 *
 * Bound to OpenCranePersonaGateway in apps/opencrane-ui/src/app/app.config.ts via
 * {@link PERSONA_GATEWAY}. Mock it at that token in tests.
 *
 * @see PersonaOnboardingService
 * @see PersonaOnboardingStates
 */
export interface PersonaGateway
{
	/**
	 * Reads the user's whole onboarding state.
	 *
	 * Safe to call at any point; it starts nothing.
	 *
	 * @returns The current state. Which fields are populated depends on `state`: `questions` during
	 *   the interview, `resolution` when a tie needs breaking, `result` from Review onwards.
	 */
	load(): Promise<PersonaOnboardingSnapshot>;
	/**
	 * Starts the interview, or does nothing if one is already running.
	 *
	 * Safe to call twice — a user has one active interview at a time.
	 *
	 * @returns Nothing; call {@link load} to see the questions.
	 */
	startInterview(): Promise<void>;
	/**
	 * Records one answer.
	 *
	 * @param interviewId - The interview the question belongs to.
	 * @param questionId - The question being answered.
	 * @param choiceId - The choice the user picked.
	 * @returns Nothing; call {@link load} to see the updated answer count.
	 */
	recordAnswer(interviewId: string, questionId: string, choiceId: string): Promise<void>;
	/**
	 * Closes a fully answered interview and scores it.
	 *
	 * Only valid once every question is answered. Scoring may produce a tie, in which case the next
	 * load returns a `resolution` and the draft cannot be created until it is broken.
	 *
	 * @param interviewId - The interview to close.
	 * @returns Nothing; call {@link load} to find out whether a tie needs breaking.
	 */
	completeInterview(interviewId: string): Promise<void>;
	/**
	 * Records the user's answer to one scoring tie.
	 *
	 * @param interviewId - The completed interview being resolved.
	 * @param kind - Which tie is being broken.
	 * @param selectedValue - One of the candidates the server offered; anything else is rejected.
	 * @returns Nothing; call {@link load} — there may be another tie after this one.
	 */
	resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>;
	/**
	 * Creates the persona draft from a completed, tie-free interview.
	 *
	 * Fails while any tie is unresolved. The draft is fixed once created; a different persona means a
	 * new interview.
	 *
	 * @param interviewId - The interview to build the draft from.
	 * @returns Nothing; call {@link load} to read the draft and its result.
	 */
	createDraft(interviewId: string): Promise<void>;
	/**
	 * Activates a draft revision as the user's persona.
	 *
	 * This is the point of no return for onboarding: after it, `state` is Ready and the first chat can
	 * begin.
	 *
	 * @param personaRevisionId - The draft revision the user confirmed.
	 * @returns Nothing; call {@link load} to confirm the state reached Ready.
	 */
	approve(personaRevisionId: string): Promise<void>;
}

/** Dependency-injection token for the active typed persona API adapter. */
export const PERSONA_GATEWAY: InjectionToken<PersonaGateway> = new InjectionToken<PersonaGateway>("PERSONA_GATEWAY");
