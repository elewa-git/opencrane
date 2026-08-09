import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";
import type { PersonaColourValues, PersonaModifierValues, PersonaScoreResult } from "../scoring/persona-scorer.types.js";

/** Owner-visible resumable state of the required personal persona onboarding flow. */
export interface PersonaOnboardingStatus
{
	/** Whether an approved persona currently makes a personal session eligible. */
	readonly state: PersonaOnboardingApiStates.Interview | PersonaOnboardingApiStates.Resolution | PersonaOnboardingApiStates.Review | PersonaOnboardingApiStates.Ready;
	/** Current interview identifier, or null before the interview is started. */
	readonly interviewId: string | null;
	/** Number of answers durably captured for the current interview. */
	readonly answeredQuestionCount: number;
	/** Total reviewed questions required for the current interview. */
	readonly questionCount: number;
	/** Current draft or approved revision identifier, when one exists. */
	readonly personaRevisionId: string | null;
	/** Frozen reviewed questions and current immutable answers for resume. */
	readonly questions: readonly PersonaStatusQuestion[];
	/** Exact next tie boundary, or null when unambiguous. */
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
	/** Authoritative raw colour counters. */
	readonly colourScores: PersonaScoreResult["colours"];
	/** Authoritative raw modifier counters. */
	readonly opennessScores: PersonaScoreResult["openness"];
	/** Three through five provenance-linked owner-visible insights. */
	readonly insights: readonly string[];
	/** Exact immutable compiled instructions under review, or null before a draft exists. */
	readonly instructionPreview: string | null;
}

/** Read-only persistence port for one authenticated owner's onboarding status. */
export interface PersonaOnboardingStatusRepository
{
	/** Reads the latest durable onboarding facts for the exact silo and user. */
	readStatus(siloId: string, userId: string): Promise<PersonaOnboardingStatus>;
}
