import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Stable failure reasons from draft derivation and persistence. */
export enum PersonaDraftDenialReasons
{
	/** The command did not identify one owner, profile, interview, and trusted instant. */
	InvalidCommand = "invalid_command",
	/** The requested profile or interview is not owned by the caller. */
	NotFoundOrWrongOwner = "not_found_or_wrong_owner",
	/** The source interview is not completed and immutable. */
	InterviewIncomplete = "interview_incomplete",
	/** The derived insight evidence is missing, duplicated, or out of bounds. */
	InvalidInsights = "invalid_insights",
	/** No reviewed template matched the completed interview evidence. */
	TemplateNotSelected = "template_not_selected",
	/** A concurrent write prevented the draft transaction from committing. */
	Conflict = "conflict",
	/** The persistence authority could not provide a durable result. */
	PersistenceUnavailable = "persistence_unavailable",
}

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
	| { readonly outcome: PersonaLifecycleOutcomes.Created; readonly personaRevisionId: string }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaDraftDenialReasons };

/** Raw persistence result before the public use case adds local command validation. */
export type CreatePersonaDraftPersistenceResult =
	| { readonly status: PersonaLifecycleOutcomes.Created; readonly personaRevisionId: string }
	| { readonly status: Exclude<PersonaDraftDenialReasons, PersonaDraftDenialReasons.InvalidCommand> };

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
