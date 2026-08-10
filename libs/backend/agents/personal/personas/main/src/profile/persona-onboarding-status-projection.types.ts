import { PersonaOnboardingApiStates } from "./persona-lifecycle.types.js";
import type { PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import type { PersonaOnboardingStatus, PersonaStatusQuestion, PersonaStatusResult } from "./persona-onboarding-status.types.js";

/** Domain-owned revision state used only to project the owner-visible onboarding route. */
export enum PersonaOnboardingStatusRevisionStates
{
	/** A complete immutable result remains under its owner's review. */
	Draft = "draft",
	/** A complete immutable result is active for the owner. */
	Approved = "approved",
}

/** Domain-owned interview state used only to project the owner-visible onboarding route. */
export enum PersonaOnboardingStatusInterviewStates
{
	/** The owner may still append answers to the reviewed interview. */
	InProgress = "in_progress",
	/** The interview is frozen and may yield score resolution or a draft. */
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
	/** Domain-owned progress state mapped at the persistence edge. */
	readonly state: PersonaOnboardingStatusInterviewStates;
	/** Number of immutable answers recorded for this interview. */
	readonly answeredQuestionCount: number;
	/** Frozen reviewed questions and selected answers for resume. */
	readonly questions: readonly PersonaStatusQuestion[];
}

/** Validated revision result associated with the latest owner-bound interview. */
export interface PersonaOnboardingStatusRevision
{
	/** Durable persona revision identifier. */
	readonly id: string;
	/** Domain-owned review or active state mapped at the persistence edge. */
	readonly state: PersonaOnboardingStatusRevisionStates;
	/** Owner-visible result after source and score evidence validation. */
	readonly result: PersonaStatusResult;
}

/** Classified source state selecting one owner-visible status projection strategy. */
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
	/** Completed interview cannot yet provide authoritative score evidence. */
	ScoreUnavailable = "score_unavailable",
	/** Completed score requires an owner tie decision. */
	ResolutionRequired = "resolution_required",
	/** Completed score is ready to become a reviewable draft. */
	ScoreReady = "score_ready",
}

/** Pure state strategy that produces one owner-visible onboarding status. */
export interface PersonaOnboardingStatusProjectionState
{
	/** Produce a bounded status only from already validated domain facts. */
	project(facts: PersonaOnboardingStatusFacts): PersonaOnboardingStatus;
}
