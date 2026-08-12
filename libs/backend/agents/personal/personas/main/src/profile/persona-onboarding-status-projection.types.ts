import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";
import type { PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import type { PersonaOnboardingStatus, PersonaStatusQuestion, PersonaStatusResult } from "./persona-onboarding-status.types.js";

/** Revision states, used only when working out what the owner sees. */
export enum PersonaOnboardingStatusRevisionStates
{
	/** The result is complete and waiting for the owner to approve it. */
	Draft = "draft",
	/** The result is approved and active. */
	Approved = "approved",
}

/** Interview states, used only when working out what the owner sees. */
export enum PersonaOnboardingStatusInterviewStates
{
	/** The owner may still append answers to the reviewed interview. */
	InProgress = "in_progress",
	/** The interview is frozen, so it can now be scored or turned into a draft. */
	Completed = "completed",
}

/** Facts loaded by the Prisma adapter before pure onboarding-status projection. */
export interface PersonaOnboardingStatusFacts
{
	/** Whether the owner has a durable persona profile. */
	readonly hasProfile: boolean;
	/** Currently active revision when no newer interview is present. */
	readonly activeRevisionId: string | null;
	/** Latest owner-bound interview and its frozen questions, when one exists. */
	readonly interview: PersonaOnboardingStatusInterview | null;
	/** Latest draft or approved result for the latest interview, when one exists. */
	readonly revision: PersonaOnboardingStatusRevision | null;
	/** Replayed score when the completed interview has no revision. */
	readonly score: PersonaScoreResult | null;
}

/** Latest owner-bound interview facts required for owner-visible projection. */
export interface PersonaOnboardingStatusInterview
{
	/** Durable interview identifier. */
	readonly id: string;
	/** The interview state, converted from Prisma's enum by the adapter. */
	readonly state: PersonaOnboardingStatusInterviewStates;
	/** Number of immutable answers recorded for this interview. */
	readonly answeredQuestionCount: number;
	/** The pinned questions plus any answer already given, so the browser can resume. */
	readonly questions: readonly PersonaStatusQuestion[];
}

/** Validated revision result associated with the latest owner-bound interview. */
export interface PersonaOnboardingStatusRevision
{
	/** Durable persona revision identifier. */
	readonly id: string;
	/** The revision state, converted from Prisma's enum by the adapter. */
	readonly state: PersonaOnboardingStatusRevisionStates;
	/** The result shown to the owner, after its stored score JSON has been checked. */
	readonly result: PersonaStatusResult;
}

/** Which situation the owner is in; each one has its own projection. */
export enum PersonaOnboardingStatusProjectionStates
{
	/** No profile exists for this owner yet. */
	NoProfile = "no_profile",
	/** Profile exists but no interview or approved revision is present. */
	NoInterview = "no_interview",
	/** Profile has an active revision and no newer interview. */
	ActivePersona = "active_persona",
	/** Latest revision remains under owner review. */
	DraftRevision = "draft_revision",
	/** Latest revision is approved and active. */
	ApprovedRevision = "approved_revision",
	/** Latest interview accepts further answers. */
	InterviewInProgress = "interview_in_progress",
	/** The interview is completed but its score could not be read. */
	ScoreUnavailable = "score_unavailable",
	/** Completed score requires an owner tie decision. */
	ResolutionRequired = "resolution_required",
	/** Completed score is ready to become a reviewable draft. */
	ScoreReady = "score_ready",
}

/** Builds the owner-visible status for one situation. */
export interface PersonaOnboardingStatusProjectionState
{
	/** Builds the status from facts the adapter has already checked. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus;
}
