/** One user-visible insight proposed for a completed onboarding answer. */
export interface PersonaDraftInsightCommand
{
	/** Exact persisted interview answer from which this statement is derived. */
	readonly answerId: string;
	/** Concise statement the owner will review before approving the persona. */
	readonly statement: string;
}

/** Request to create one reviewable persona draft from a completed onboarding interview. */
export interface CreatePersonaDraftCommand
{
	/** Silo that owns the profile and interview evidence. */
	readonly siloId: string;
	/** Profile owner and only allowed draft author. */
	readonly userId: string;
	/** Personal persona profile receiving the next draft revision. */
	readonly personaProfileId: string;
	/** Completed interview whose answers deterministically select the template. */
	readonly interviewId: string;
	/** Three to five statements, each bound to a distinct stored interview answer. */
	readonly insights: readonly PersonaDraftInsightCommand[];
	/** Trusted instant at which this reviewable draft is authored. */
	readonly authoredAt: string;
}

/** Stable outcome from creating a reviewable interview-backed persona draft. */
export type CreatePersonaDraftResult =
	| { readonly outcome: "created"; readonly personaRevisionId: string }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "not_found_or_wrong_owner" | "interview_incomplete" | "invalid_insights" | "template_not_selected" | "conflict" | "persistence_unavailable" };

/** Raw persistence result before the public use case adds local command validation. */
export type CreatePersonaDraftPersistenceResult =
	| { readonly status: "created"; readonly personaRevisionId: string }
	| { readonly status: "not_found_or_wrong_owner" | "interview_incomplete" | "invalid_insights" | "template_not_selected" | "conflict" | "persistence_unavailable" };

/** Persistence boundary that creates one immutable, reviewable persona draft. */
export interface PersonaDraftRepository
{
	/** Atomically derives and persists a draft from exact completed-interview evidence. */
	createAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>;
}

/** Server-only boundary that derives answer-provenance-bound insights before creating a draft. */
export interface PersonaDraftFromInterviewRepository
{
	/** Creates a draft using a bounded server-derived insight set from one completed owner interview. */
	createFromInterviewAtomically(command: Omit<CreatePersonaDraftCommand, "insights">): Promise<CreatePersonaDraftPersistenceResult>;
}
