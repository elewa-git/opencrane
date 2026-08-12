import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** The two revision states approval can see in its snapshot. */
export enum PersonaApprovalRevisionStates
{
	/** The owner can still review it, and it can be approved once. */
	Draft = "draft",
	/** It is already approved and cannot be approved again. */
	Approved = "approved",
}

/** The two interview states approval can see in its snapshot. */
export enum PersonaApprovalInterviewStates
{
	/** The interview still accepts answers, so a draft built from it cannot be approved. */
	InProgress = "in_progress",
	/** The interview is frozen, so a draft built from it may be approved. */
	Completed = "completed",
}

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

/** Everything approval checks, read in one transaction so the values cannot disagree with each other. */
export interface PersonaApprovalSnapshot
{
	/** Current profile owner. */
	readonly profileUserId: string;
	/** The revision currently active on the profile. A retry counts as already-approved only when this is the revision being approved. */
	readonly activeRevisionId: string | null;
	/** Current persona revision state. */
	readonly revisionState: PersonaApprovalRevisionStates;
	/** Profile owning the revision. */
	readonly revisionProfileId: string;
	/** Interview state supporting the revision. */
	readonly interviewState: PersonaApprovalInterviewStates;
	/** How many insight rows the revision has. */
	readonly insightCount: number;
	/** Whether the revision's pinned template digest still matches the template row. */
	readonly templateDigestMatches: boolean;
	/** Whether a recomputed score, its tie choices, the pinned source digests, and the selected template all still match what the revision stored. */
	readonly templateSelectionMatches: boolean;
	/** The policy value exactly as stored. It stays a plain string so an unrecognised value blocks approval instead of being mapped onto a local enum. */
	readonly durableSoulMutationPolicy: string;
}

/** The approval request plus the snapshot values that must still hold when the update runs. */
export interface AtomicApprovePersonaCommand extends ApprovePersonaCommand
{
	/** Draft state that must still hold when the update commits. */
	readonly expectedRevisionState: PersonaApprovalRevisionStates.Draft;
	/** Completed interview state that must still hold when the update commits. */
	readonly expectedInterviewState: PersonaApprovalInterviewStates.Completed;
	/** The insight count seen at preflight; it must be between three and five. */
	readonly expectedInsightCount: number;
}

/** What the approval transaction reports back. */
export enum PersonaApprovalPersistenceStatuses
{
	/** The draft, active-pointer update, and any attached refresh proposal committed together. */
	Approved = "approved",
	/** Another writer changed something, or a precondition no longer held, so nothing was committed. */
	Conflict = "conflict",
	/** The owner's profile was not found inside the transaction. */
	NotFound = "not_found",
}

/** Persistence result from approving and activating one revision transactionally. */
export type AtomicApprovePersonaResult = { readonly status: PersonaApprovalPersistenceStatuses.Approved } | { readonly status: PersonaApprovalPersistenceStatuses.Conflict } | { readonly status: PersonaApprovalPersistenceStatuses.NotFound };

/**
 * Reasons {@link __ApprovePersona} refuses to approve a draft.
 *
 * These split into three groups, and the caller must treat them differently. `InvalidCommand` and
 * `NotFound`/`WrongOwner` mean the request itself was wrong — retrying changes nothing. `Conflict`
 * means another writer got there first: re-read the owner's status and try again, because the draft
 * may already be approved. Everything else (`NotDraft`, `InterviewIncomplete`, `InvalidInsights`,
 * `TemplateMismatch`, `TemplateSelectionMismatch`, `MutableSoulPolicy`) means this particular draft
 * can never be approved and the owner needs a new one derived from the interview.
 *
 * Conflating `Conflict` with the last group is the mistake to avoid: it would tell the owner their
 * persona is permanently broken when a simple retry would have worked.
 *
 * The router maps each reason to an HTTP status in `_APPROVAL_DENIAL_STATUS_BY_REASON`; both
 * `NotFound` and `WrongOwner` become 404 so a caller cannot tell another user's revision from a
 * missing one.
 */
export enum PersonaApprovalDenialReasons
{
	/** The request left out an identifier, or its timestamp could not be parsed. */
	InvalidCommand = "invalid_command",
	/** No persona revision was visible through the owner profile. */
	NotFound = "not_found",
	/** The revision or profile belongs to a different owner. */
	WrongOwner = "wrong_owner",
	/** The requested revision is not awaiting approval. */
	NotDraft = "not_draft",
	/** The interview behind the draft is not completed yet. */
	InterviewIncomplete = "interview_incomplete",
	/** The draft does not have between three and five insights. */
	InvalidInsights = "invalid_insights",
	/** The reviewed template digest no longer matches the draft. */
	TemplateMismatch = "template_mismatch",
	/** A recomputed score no longer selects the template the draft pinned. */
	TemplateSelectionMismatch = "template_selection_mismatch",
	/** The revision's stored SOUL mutation policy is not `forbidden`, so it could allow the persona file to change after approval. */
	MutableSoulPolicy = "mutable_soul_policy",
	/** Another writer changed the rows, or the bound refresh proposal could not be applied, so the commit was abandoned. */
	Conflict = "conflict",
}

/**
 * Stores persona approval.
 *
 * Marking the revision approved and pointing the profile at it must both happen or neither, so the
 * implementation runs them in one Serializable transaction. That is why the second method's name ends
 * in `Atomically`: it is not a hint, it is the contract, and an implementation that split the two
 * writes could leave a profile pointing at a draft.
 *
 * Called by: {@link __ApprovePersona} and the revision-state classes in
 * persona-approval-revision-state.ts. Implemented by `PrismaPersonaAuthorityRepository` and, through
 * delegation, by `PrismaPersonaPersistenceUnitOfWork`.
 *
 * @see PrismaPersonaAuthorityRepository
 * @see PersonaPersistenceUnitOfWork
 */
export interface PersonaAuthorityRepository
{
	/**
	 * Loads profile, revision, interview, template, and insight facts in one transaction.
	 *
	 * @param command - The owner, profile, and revision being approved.
	 * @returns The snapshot, or `null` when no revision matches this profile and revision id. A `null`
	 * obliges the caller to deny with `NotFound`; it must not be read as "not approvable yet".
	 */
	getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>;
	/**
	 * Marks the revision approved and points the profile at it, in one Serializable transaction.
	 *
	 * @param command - The approval request plus the snapshot values that must still hold.
	 * @returns `Approved` when both writes committed. `Conflict` when a precondition no longer held, or
	 * another writer won — the caller must re-read the snapshot before deciding whether this request's
	 * revision ended up active anyway. `NotFound` when the owner's profile was not visible inside the
	 * transaction.
	 */
	approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>;
}
export interface PersonaAuthorityRepository
{
	/** Loads one consistent snapshot of profile, revision, interview, template, and insights. */
	getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>;
	/** Approves and activates, but only while every precondition from the snapshot still holds. */
	approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>;
}

/** Stable result of persona approval. */
export type ApprovePersonaResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Approved }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaApprovalDenialReasons };
