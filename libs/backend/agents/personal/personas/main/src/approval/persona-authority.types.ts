/** Request to approve and activate one exact persona draft. */
export interface ApprovePersonaCommand
{
	/** Persona profile owned by the approving user. */
	readonly personaProfileId: string;
	/** Exact draft revision being approved. */
	readonly personaRevisionId: string;
	/** User who owns and approves the persona. */
	readonly userId: string;
	/** Trusted approval instant. */
	readonly approvedAt: string;
}

/** Consistent persona evidence loaded before approval. */
export interface PersonaApprovalSnapshot
{
	/** Current profile owner. */
	readonly profileUserId: string;
	/** Current persona revision state. */
	readonly revisionState: "draft" | "approved";
	/** Profile owning the revision. */
	readonly revisionProfileId: string;
	/** Interview state supporting the revision. */
	readonly interviewState: "in_progress" | "completed";
	/** Number of explicit provenance-linked insights. */
	readonly insightCount: number;
	/** Exact reviewed template digest pinned by the revision. */
	readonly templateDigestMatches: boolean;
	/** Deterministic winning template rule and exact answer evidence match the interview. */
	readonly templateSelectionMatches: boolean;
	/** Fixed policy preventing runtime mutation of durable SOUL sources. */
	readonly durableSoulMutationPolicy: string;
}

/** Atomic approval command carrying every accepted precondition. */
export interface AtomicApprovePersonaCommand extends ApprovePersonaCommand
{
	/** Draft state that must still hold when the update commits. */
	readonly expectedRevisionState: "draft";
	/** Completed interview state that must still hold when the update commits. */
	readonly expectedInterviewState: "completed";
	/** Exact accepted insight count from three through five. */
	readonly expectedInsightCount: number;
}

/** Stable persistence outcomes from the approval transaction boundary. */
export enum PersonaApprovalPersistenceStatuses
{
	/** The draft, active-pointer update, and any attached refresh proposal committed together. */
	Approved = "approved",
	/** A concurrent or stale precondition prevented the transaction from committing. */
	Conflict = "conflict",
	/** The requested owner profile was absent at the atomic authority boundary. */
	NotFound = "not_found",
}

/** Persistence result from approving and activating one revision transactionally. */
export type AtomicApprovePersonaResult = { readonly status: PersonaApprovalPersistenceStatuses.Approved } | { readonly status: PersonaApprovalPersistenceStatuses.Conflict } | { readonly status: PersonaApprovalPersistenceStatuses.NotFound };

/** Stable owner-visible approval denials mapped explicitly by the HTTP adapter. */
export enum PersonaApprovalDenialReasons
{
	/** The request omitted an identifier or trustworthy approval instant. */
	InvalidCommand = "invalid_command",
	/** No persona revision was visible through the owner profile. */
	NotFound = "not_found",
	/** The revision or profile belongs to a different owner. */
	WrongOwner = "wrong_owner",
	/** The requested revision is not awaiting approval. */
	NotDraft = "not_draft",
	/** The supporting interview has not become immutable. */
	InterviewIncomplete = "interview_incomplete",
	/** The draft does not carry the required bounded insight evidence. */
	InvalidInsights = "invalid_insights",
	/** The reviewed template digest no longer matches the draft. */
	TemplateMismatch = "template_mismatch",
	/** The deterministic template-selection evidence no longer matches the interview. */
	TemplateSelectionMismatch = "template_selection_mismatch",
	/** The draft would permit forbidden mutable durable SOUL state. */
	MutableSoulPolicy = "mutable_soul_policy",
	/** A concurrent mutation or missing expected refresh invalidated the approval commit. */
	Conflict = "conflict",
}

/** Persona persistence boundary keeping approval and active-pointer update atomic. */
export interface PersonaAuthorityRepository
{
	/** Loads one consistent snapshot of profile, revision, interview, template, and insights. */
	getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>;
	/** Approves and activates only while every accepted precondition still matches. */
	approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>;
}

/** Stable result of persona approval. */
export type ApprovePersonaResult =
	| { readonly outcome: "approved" }
	| { readonly outcome: "denied"; readonly reason: PersonaApprovalDenialReasons };
