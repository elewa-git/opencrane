import { InjectionToken } from "@angular/core";

import { type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/models/user-onboarding";

/**
 * Commands the signed-in owner's persona-onboarding API.
 *
 * Commands return no projection, so callers reload after every write and adopt the server result.
 * The workflow runs interview → optional tie resolution → draft → approval; the server rejects
 * commands attempted outside their current stage. Implementations must preserve that rejection
 * instead of advancing local state optimistically.
 *
 * Called by: {@link PersonaOnboardingService}. Implemented by `OpenCranePersonaGateway` for the live
 * profile and `LocalDevelopmentPersonaGateway` for Tier 1.
 * @see PersonaOnboardingSnapshot for the model returned by {@link load}.
 */
export interface PersonaGateway
{
	/** Reads the current server-owned projection without starting a workflow. */
	load(): Promise<PersonaOnboardingSnapshot>;
	/** Starts or resumes the owner's active interview. */
	startInterview(): Promise<void>;
	/**
	 * Records one reviewed answer for the active interview.
	 *
	 * @param interviewId - Interview that owns the reviewed question.
	 * @param questionId - Reviewed question being answered.
	 * @param choiceId - Reviewed choice selected by the owner.
	 */
	recordAnswer(interviewId: string, questionId: string, choiceId: string): Promise<void>;
	/**
	 * Closes and scores a fully answered interview.
	 *
	 * @param interviewId - Fully answered interview to score.
	 */
	completeInterview(interviewId: string): Promise<void>;
	/**
	 * Records the owner's explicit choice for one scoring tie.
	 *
	 * @param interviewId - Completed interview whose score is tied.
	 * @param kind - Scoring dimension the owner is resolving.
	 * @param selectedValue - Candidate returned by the current projection.
	 */
	resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>;
	/**
	 * Creates the immutable persona draft after scoring has no unresolved tie.
	 *
	 * @param interviewId - Completed interview used to build the draft.
	 */
	createDraft(interviewId: string): Promise<void>;
	/**
	 * Activates the reviewed persona revision for future admitted runs.
	 *
	 * @param personaRevisionId - Draft revision the owner reviewed and confirmed.
	 */
	approve(personaRevisionId: string): Promise<void>;
}

/**
 * Lets the application profile bind the live or Tier 1 {@link PersonaGateway} without making the
 * onboarding service depend on either adapter. The token has no default factory, so a missing
 * profile binding fails during service construction.
 */
export const PERSONA_GATEWAY: InjectionToken<PersonaGateway> = new InjectionToken<PersonaGateway>("PERSONA_GATEWAY");
