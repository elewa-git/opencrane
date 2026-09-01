import { PersonaOnboardingApiStates } from "./persona-lifecycle.types";
import type { PersonaColourValues, PersonaModifierValues, PersonaScoreResult } from "../scoring/persona-scorer.types";

/** What the owner still has to do in persona onboarding, plus enough detail to resume it. */
export interface PersonaOnboardingStatus
{
	/** Which step the owner is on: interview, tie resolution, review, or ready. */
	readonly state: PersonaOnboardingApiStates.Interview | PersonaOnboardingApiStates.Resolution | PersonaOnboardingApiStates.Review | PersonaOnboardingApiStates.Ready;
	/** Current interview identifier, or null before the interview is started. */
	readonly interviewId: string | null;
	/** Number of answers durably captured for the current interview. */
	readonly answeredQuestionCount: number;
	/** Total reviewed questions required for the current interview. */
	readonly questionCount: number;
	/** Current draft or approved revision identifier, when one exists. */
	readonly personaRevisionId: string | null;
	/** The interview's pinned questions plus any answer already given, so the browser can resume. */
	readonly questions: readonly PersonaStatusQuestion[];
	/** The tie the owner must break next, or null when scoring produced a clear winner. */
	readonly resolution: PersonaScoreResult["resolutionRequired"];
	/** Reviewable or approved persona result, or null before scoring completes. */
	readonly result: PersonaStatusResult | null;
}

/** One reviewed answer choice shown by the owner-only persona API. */
export interface PersonaStatusChoice
{
	/** Stable choice identity. */
	readonly id: string;
	/** Reviewed owner-visible label. */
	readonly label: string;
	/** Stable display order. */
	readonly ordinal: number;
}

/** One frozen question plus an already-selected choice when resuming. */
export interface PersonaStatusQuestion
{
	/** Stable question identity. */
	readonly id: string;
	/** Reviewed grouping category. */
	readonly category: string;
	/** Reviewed owner-visible prompt. */
	readonly prompt: string;
	/** Stable display order. */
	readonly ordinal: number;
	/** Reviewed choice list. */
	readonly choices: readonly PersonaStatusChoice[];
	/** Immutable selected choice, or null while unanswered. */
	readonly selectedChoiceId: string | null;
}

/** Owner-visible review result without compiled runtime instructions. */
export interface PersonaStatusResult
{
	/** Reviewed archetype/modifier display name. */
	readonly displayName: string;
	/** Resolved primary colour. */
	readonly primaryColour: PersonaColourValues;
	/** Resolved secondary blend colour. */
	readonly secondaryColour: PersonaColourValues;
	/** Resolved Explorer/Guardian modifier. */
	readonly modifier: PersonaModifierValues;
	/** The colour counters exactly as scored, not percentages. */
	readonly colourScores: PersonaScoreResult["colours"];
	/** The Explorer and Guardian counters exactly as scored, not percentages. */
	readonly opennessScores: PersonaScoreResult["openness"];
	/** Three to five short explanations shown to the owner, each derived from one of their answers. */
	readonly insights: readonly string[];
	/** The compiled persona instructions the owner is reviewing, or null before a draft exists. */
	readonly instructionPreview: string | null;
}

/**
 * Reads the owner's current persona onboarding state.
 *
 * This is the one read the browser polls to decide what to show, so it never writes and never fails
 * with a refusal — an owner with no profile at all gets the empty starting status rather than an error.
 *
 * Called by: the GET /me/persona route in persona-onboarding.router.ts, via the router's `status`
 * dependency. Implemented by `PrismaPersonaOnboardingStatusRepository` and, through delegation, by
 * `PrismaPersonaPersistenceUnitOfWork`.
 *
 * @see PersonaOnboardingStatus
 */
export interface PersonaOnboardingStatusRepository
{
	/**
	 * Reads the current onboarding state for this silo and user.
	 *
	 * @param siloId - Silo taken from the authenticated request host.
	 * @param userId - The signed-in owner.
	 * @returns The owner's status. Branch on `state`: `interview` means send them to the questions,
	 * `resolution` means a tie needs breaking, `review` means a result is waiting for approval, and
	 * `ready` means an approved persona is active. An owner with no profile yet gets the `interview`
	 * state with empty lists, so the caller needs no separate not-found branch.
	 * @throws Error when a stored revision's score JSON cannot be validated against its own columns —
	 * that is a data fault, not a normal outcome.
	 */
	readStatus(siloId: string, principalId: string, userId: string): Promise<PersonaOnboardingStatus>;
}
