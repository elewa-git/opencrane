/** Request to bind one accepted persona-refresh change to a new reviewed interview. */
export interface StartPersonaRefreshInterviewCommand
{
	/** Silo owning the profile, service, and accepted configuration change. */
	readonly siloId: string;
	/** Profile owner starting the refresh interview. */
	readonly userId: string;
	/** Profile that will receive the future approved persona revision. */
	readonly personaProfileId: string;
	/** Accepted persona-refresh change that this interview evidences. */
	readonly refreshChangeId: string;
	/** Exact reviewed question-set identifier selected for the interview. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version selected for the interview. */
	readonly questionSetVersion: number;
	/** Trusted server instant at which the interview begins. */
	readonly startedAt: string;
}

/** Stable result from starting or recovering a refresh-specific interview. */
export type StartPersonaRefreshInterviewResult =
	| { readonly outcome: "started" | "already_started"; readonly interviewId: string }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "refresh_unavailable" | "interview_in_progress" | "question_set_unavailable" | "persistence_unavailable" };

/** Transactional persistence boundary for a refresh-specific interview link. */
export interface PersonaRefreshInterviewRepository
{
	/** Starts exactly one linked interview without claiming unrelated active interview evidence. */
	startRefreshAtomically(command: StartPersonaRefreshInterviewCommand): Promise<{ readonly status: "started" | "already_started"; readonly interviewId: string } | { readonly status: "refresh_unavailable" | "interview_in_progress" | "question_set_unavailable" | "persistence_unavailable" }>;
}

/** Request to approve a refresh-derived draft and atomically advance both personal revision heads. */
export interface ApprovePersonaRefreshCommand
{
	/** Silo owning the linked personal service. */
	readonly siloId: string;
	/** Owner of the persona profile and accepted refresh. */
	readonly userId: string;
	/** Profile whose draft revision will become active. */
	readonly personaProfileId: string;
	/** Exact draft produced from the refresh-linked completed interview. */
	readonly personaRevisionId: string;
	/** Trusted approval instant. */
	readonly approvedAt: string;
}

/** Stable result from atomically applying a refresh-derived persona revision. */
export type ApprovePersonaRefreshResult = { readonly outcome: "approved"; readonly agentRevisionId: string } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "refresh_unavailable" | "approval_unavailable" | "conflict" | "persistence_unavailable" };

/** Persistence boundary for refresh-specific persona and agent revision application. */
export interface PersonaRefreshApprovalRepository
{
	/** Approves and applies one linked refresh in the sole transaction that advances both heads. */
	approveRefreshAtomically(command: ApprovePersonaRefreshCommand): Promise<{ readonly status: "approved"; readonly agentRevisionId: string } | { readonly status: "refresh_unavailable" | "approval_unavailable" | "conflict" | "persistence_unavailable" }>;
}
