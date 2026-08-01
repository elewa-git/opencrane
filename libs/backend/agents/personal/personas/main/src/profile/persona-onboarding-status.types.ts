import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";

/** Owner-visible resumable state of the required personal persona onboarding flow. */
export interface PersonaOnboardingStatus
{
	/** Whether an approved persona currently makes a personal session eligible. */
	readonly state: PersonaOnboardingApiStates.Interview | PersonaOnboardingApiStates.Review | PersonaOnboardingApiStates.Ready;
	/** Current interview identifier, or null before the interview is started. */
	readonly interviewId: string | null;
	/** Number of answers durably captured for the current interview. */
	readonly answeredQuestionCount: number;
	/** Total reviewed questions required for the current interview. */
	readonly questionCount: number;
	/** Current draft or approved revision identifier, when one exists. */
	readonly personaRevisionId: string | null;
}

/** Read-only persistence port for one authenticated owner's onboarding status. */
export interface PersonaOnboardingStatusRepository
{
	/** Reads the latest durable onboarding facts for the exact silo and user. */
	readStatus(siloId: string, userId: string): Promise<PersonaOnboardingStatus>;
}
