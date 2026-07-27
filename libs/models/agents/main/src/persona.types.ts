import type { PersonaProfileId, PersonaRevisionId, UserId } from "./identifiers.types.js";

/** Required topics covered by every onboarding interview question set. */
export type PersonaInterviewCategory = "relationship_role" | "tone_language" | "answer_structure" | "challenge_support" | "initiative" | "approval_risk" | "working_habits" | "memory_boundaries";

/** Lifecycle state of one onboarding interview attempt. */
export type PersonaInterviewState = "in_progress" | "completed";

/** Review state of a generated persona revision. */
export type PersonaRevisionState = "draft" | "approved";

/** State of the required personal-agent onboarding flow. */
export type PersonaOnboardingState = "interview" | "review" | "ready";

/** A versioned key question in the persona onboarding interview. */
export interface PersonaInterviewQuestion
{
	/** Stable question identifier across question-set revisions. */
	readonly id: string;
	/** Required onboarding topic addressed by the question. */
	readonly category: PersonaInterviewCategory;
	/** User-visible interview prompt. */
	readonly prompt: string;
}

/** Reviewed, versioned set of required persona onboarding questions. */
export interface PersonaInterviewQuestionSet
{
	/** Stable question-set identifier. */
	readonly id: string;
	/** Positive monotonically increasing question-set version. */
	readonly version: number;
	/** Questions presented to the user. */
	readonly questions: readonly PersonaInterviewQuestion[];
	/** Reviewer who accepted the question set for product use. */
	readonly reviewedBy: UserId;
	/** ISO-8601 instant at which the question set was reviewed. */
	readonly reviewedAt: string;
}

/** One explicit user answer captured during onboarding. */
export interface PersonaInterviewAnswer
{
	/** Stable answer identifier used by insight provenance. */
	readonly id: string;
	/** Question answered by the user. */
	readonly questionId: string;
	/** Normalized answer value used for template selection and insight extraction. */
	readonly value: string;
	/** ISO-8601 instant at which the answer was recorded. */
	readonly answeredAt: string;
}

/** One complete or in-progress onboarding interview attempt. */
export interface PersonaInterview
{
	/** Stable interview-attempt identifier. */
	readonly id: string;
	/** User completing the interview. */
	readonly userId: UserId;
	/** Selected versioned question-set identifier. */
	readonly questionSetId: string;
	/** Selected versioned question-set version. */
	readonly questionSetVersion: number;
	/** Current interview lifecycle state. */
	readonly state: PersonaInterviewState;
	/** User answers recorded for this attempt. */
	readonly answers: readonly PersonaInterviewAnswer[];
	/** ISO-8601 instant at which the attempt began. */
	readonly startedAt: string;
	/** ISO-8601 completion instant, or null while incomplete. */
	readonly completedAt: string | null;
}

/** A weighted answer match used to select a reviewed persona template. */
export interface SoulTemplateSelectionRule
{
	/** Question whose answer participates in this rule. */
	readonly questionId: string;
	/** Normalized answer values accepted by the rule. */
	readonly acceptedValues: readonly string[];
	/** Positive score awarded when the answer matches. */
	readonly weight: number;
}

/** Reviewed, versioned `SOUL.md` source template. */
export interface SoulTemplate
{
	/** Stable template identifier. */
	readonly id: string;
	/** Positive monotonically increasing template version. */
	readonly version: number;
	/** Fixed source name proving the template is a `SOUL.md` source. */
	readonly sourceName: "SOUL.md";
	/** Reviewed template content before interview insight infusion. */
	readonly content: string;
	/** Rules that select this template from key interview answers. */
	readonly selectionRules: readonly SoulTemplateSelectionRule[];
	/** Reviewer who accepted the template for product use. */
	readonly reviewedBy: UserId;
	/** ISO-8601 instant at which the template was reviewed. */
	readonly reviewedAt: string;
}

/** Explicit provenance linking one persona insight to an interview answer. */
export interface PersonaInsightProvenance
{
	/** Interview attempt from which the insight was extracted. */
	readonly interviewId: string;
	/** Versioned question-set identifier used by the interview. */
	readonly questionSetId: string;
	/** Versioned question-set version used by the interview. */
	readonly questionSetVersion: number;
	/** Question whose answer supports the insight. */
	readonly questionId: string;
	/** Exact answer supporting the insight. */
	readonly answerId: string;
}

/** High-signal persona statement explicitly visible to the user. */
export interface PersonaInsight
{
	/** Stable insight identifier within the persona revision. */
	readonly id: string;
	/** Required onboarding topic represented by the insight. */
	readonly category: PersonaInterviewCategory;
	/** User-visible statement infused into the selected template. */
	readonly statement: string;
	/** Explicit link back to the supporting interview answer. */
	readonly provenance: PersonaInsightProvenance;
}

/** Immutable reference to the reviewed `SOUL.md` template source. */
export interface SoulTemplateReference
{
	/** Stable selected template identifier. */
	readonly id: string;
	/** Exact selected template version. */
	readonly version: number;
	/** Content digest or stable review digest supplied by the caller. */
	readonly digest: string;
}

/** Deterministic, reviewable personal-assistant identity revision. */
export interface PersonaRevision
{
	/** Stable persona-revision identifier. */
	readonly id: PersonaRevisionId;
	/** Persona profile to which the revision belongs. */
	readonly personaProfileId: PersonaProfileId;
	/** Positive monotonically increasing revision number. */
	readonly revision: number;
	/** Current user-review state. */
	readonly state: PersonaRevisionState;
	/** Reviewed source template selected from interview answers. */
	readonly soulTemplate: SoulTemplateReference;
	/** Interview attempt that produced the revision. */
	readonly interviewId: string;
	/** Three to five explicit provenance-linked interview insights. */
	readonly insights: readonly PersonaInsight[];
	/** Deterministically compiled personal-layer instructions shown in preview. */
	readonly compiledInstructions: string;
	/** Previous persona revision, or null for the first revision. */
	readonly previousRevisionId: PersonaRevisionId | null;
	/** User who authored or edited the draft. */
	readonly authoredBy: UserId;
	/** ISO-8601 instant at which the draft was created. */
	readonly createdAt: string;
	/** User who approved the revision, or null while still a draft. */
	readonly approvedBy: UserId | null;
	/** ISO-8601 approval instant, or null while still a draft. */
	readonly approvedAt: string | null;
	/** Fixed policy preventing runtime mutation of durable template sources. */
	readonly durableSoulMutationPolicy: "forbidden";
}

/** Required onboarding state associated with one personal user. */
export interface PersonaOnboarding
{
	/** User who must complete onboarding. */
	readonly userId: UserId;
	/** Current onboarding lifecycle state. */
	readonly state: PersonaOnboardingState;
	/** Current interview attempt. */
	readonly interview: PersonaInterview;
	/** Draft or approved persona under review, or null during the interview. */
	readonly personaRevision: PersonaRevision | null;
}

/** Input required to create a persona draft from completed interview evidence. */
export interface CreatePersonaDraftInput
{
	/** Identifier assigned to the new persona revision. */
	readonly personaRevisionId: PersonaRevisionId;
	/** Profile receiving the new persona revision. */
	readonly personaProfileId: PersonaProfileId;
	/** Positive revision number assigned by the profile owner. */
	readonly revision: number;
	/** Completed onboarding interview. */
	readonly interview: PersonaInterview;
	/** Reviewed question set used by the interview. */
	readonly questionSet: PersonaInterviewQuestionSet;
	/** Reviewed templates eligible for answer-based selection. */
	readonly templates: readonly SoulTemplate[];
	/** Three to five explicit insights extracted from the interview. */
	readonly insights: readonly PersonaInsight[];
	/** Digest of the selected reviewed template. */
	readonly selectedTemplateDigest: string;
	/** User authoring the initial persona draft. */
	readonly authoredBy: UserId;
	/** ISO-8601 instant at which the draft is created. */
	readonly createdAt: string;
}

/** Input required to create an edited draft that must be approved again. */
export interface EditPersonaDraftInput
{
	/** Existing draft or approved revision being edited. */
	readonly revision: PersonaRevision;
	/** Identifier assigned to the edited revision. */
	readonly personaRevisionId: PersonaRevisionId;
	/** Next positive monotonically increasing revision number. */
	readonly revisionNumber: number;
	/** User-visible edited personal-layer instructions. */
	readonly compiledInstructions: string;
	/** User who performed the edit. */
	readonly editedBy: UserId;
	/** ISO-8601 instant at which the edit was made. */
	readonly editedAt: string;
}

/** Runtime-only compiled persona input with no mutable durable file authority. */
export interface PersonaRuntimeInput
{
	/** Approved persona revision consumed by the runtime. */
	readonly personaRevisionId: PersonaRevisionId;
	/** Compiled personal-layer instructions supplied to prompt compilation. */
	readonly compiledInstructions: string;
	/** Fixed source classification excluding mutable workspace files. */
	readonly source: "compiled_persona_revision";
	/** Fixed runtime policy preventing durable `SOUL.md` mutation. */
	readonly durableSoulMutationPolicy: "forbidden";
}

/** Successful persona-domain operation. */
export interface PersonaSuccess<T>
{
	/** Success discriminator. */
	readonly ok: true;
	/** Valid result value. */
	readonly value: T;
}

/** Failed persona-domain operation. */
export interface PersonaFailure
{
	/** Failure discriminator. */
	readonly ok: false;
	/** Stable failure code for callers and tests. */
	readonly code: "invalid_question_set" | "invalid_interview" | "template_not_selected" | "ambiguous_template" | "invalid_insights" | "invalid_revision" | "invalid_onboarding_state";
	/** Human-readable invariant violation. */
	readonly message: string;
}

/** Result of a persona-domain operation. */
export type PersonaResult<T> = PersonaSuccess<T> | PersonaFailure;
