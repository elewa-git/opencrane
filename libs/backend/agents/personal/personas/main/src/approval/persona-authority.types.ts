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

/** Persistence result from approving and activating one revision transactionally. */
export type AtomicApprovePersonaResult = { readonly status: "approved" } | { readonly status: "conflict" } | { readonly status: "not_found" };

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
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found" | "wrong_owner" | "not_draft" | "interview_incomplete" | "invalid_insights" | "template_mismatch" | "template_selection_mismatch" | "mutable_soul_policy" | "conflict" };
