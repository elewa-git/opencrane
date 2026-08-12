import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Reasons creating a persona draft fails. */
export enum PersonaDraftDenialReasons
{
	/** The request left out the silo, owner, profile, interview, or timestamp. */
	InvalidCommand = "invalid_command",
	/** The requested profile or interview is not owned by the caller. */
	NotFoundOrWrongOwner = "not_found_or_wrong_owner",
	/** The interview is not completed. */
	InterviewIncomplete = "interview_incomplete",
	/** The derived insight evidence is missing, duplicated, or out of bounds. */
	InvalidInsights = "invalid_insights",
	/** No reviewed template matched the completed interview evidence. */
	TemplateNotSelected = "template_not_selected",
	/** A scoring tie still needs the owner's choice. */
	ResolutionRequired = "resolution_required",
	/** The stored score could not be recomputed to the same values, or the interpolation map failed to parse. */
	DerivationMismatch = "derivation_mismatch",
	/** A concurrent write prevented the draft transaction from committing. */
	Conflict = "conflict",
	/** The database call failed. */
	PersistenceUnavailable = "persistence_unavailable",
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
	/** Server timestamp recorded as the draft's creation time. */
	readonly authoredAt: string;
}

/** Stable outcome from creating a reviewable interview-backed persona draft. */
export type CreatePersonaDraftResult =
	| { readonly outcome: PersonaLifecycleOutcomes.Created; readonly personaRevisionId: string }
	| { readonly outcome: PersonaLifecycleOutcomes.Denied; readonly reason: PersonaDraftDenialReasons };

/** What the repository returns, before the use case adds its own request validation. */
export type CreatePersonaDraftPersistenceResult =
	| { readonly status: PersonaLifecycleOutcomes.Created; readonly personaRevisionId: string }
	| { readonly status: Exclude<PersonaDraftDenialReasons, PersonaDraftDenialReasons.InvalidCommand> };

/**
 * Creates a persona draft revision from one completed interview.
 *
 * The draft's compiled instructions and its insight wording are both derived on the server from the
 * owner's answers. A caller cannot supply either, which is what stops a browser from writing its own
 * persona text. Each insight records the answer it came from, so a reviewer can see why the persona
 * says what it says.
 *
 * The method name ends in `Atomically` because the revision row and its insight rows must be written
 * together, in the same Serializable transaction that re-reads the score — a revision with the wrong
 * number of insights would fail approval and could never be fixed.
 *
 * Called by: {@link __CreatePersonaDraftFromInterview}, and supplied to the router as its `drafts`
 * dependency. Implemented by `PrismaPersonaDraftRepository` and, through delegation, by
 * `PrismaPersonaPersistenceUnitOfWork`.
 *
 * @see PersonaDraftDenialReasons
 * @see PersonaDraftSourceDerivationResult
 */
export interface PersonaDraftFromInterviewRepository
{
	/** Creates a draft from one completed interview, with three to five insights derived on the server. */
	createFromInterviewAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>;
}
