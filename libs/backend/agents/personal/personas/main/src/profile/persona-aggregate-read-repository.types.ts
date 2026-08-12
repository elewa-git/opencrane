/** The interview states this reader returns. */
export enum PersonaAggregateInterviewStates
{
	/** The owner may still append reviewed-question answers. */
	InProgress = "in_progress",
	/** The answers are frozen, so a draft can be derived from them. */
	Completed = "completed",
}

/** Identifies one owner's persona profile by silo, owner, and profile id. */
export interface PersonaProfileReadCommand
{
	/** Silo that owns the persona aggregate. */
	readonly siloId: string;
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** The persona profile being read or changed. */
	readonly personaProfileId: string;
}

/** Identifies one owner's persona profile without naming the silo; the silo comes back from the row. */
export interface PersonaProfileOwnerReadCommand
{
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** The persona profile being read or changed. */
	readonly personaProfileId: string;
}

/** The profile fields the interview, draft, and approval paths all need. */
export interface PersonaProfileRecord
{
	/** The profile's silo, needed later to apply a refresh proposal. */
	readonly siloId: string;
	/** Previously active immutable persona revision, if any. */
	readonly activeRevisionId: string | null;
}

/** Identifies one interview belonging to the caller's profile. */
export interface PersonaInterviewReadCommand
{
	/** Persona profile that owns the interview. */
	readonly personaProfileId: string;
	/** Authenticated owner of the interview. */
	readonly userId: string;
	/** Interview being read or mutated. */
	readonly interviewId: string;
}

/** The interview fields the answer, completion, and draft steps need. */
export interface PersonaInterviewRecord
{
	/** Reviewed question-set identifier frozen when the interview started. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version frozen when the interview started. */
	readonly questionSetVersion: number;
	/** Current durable lifecycle state. */
	readonly state: PersonaAggregateInterviewStates;
}

/** Identifies one draft revision belonging to the caller's profile. */
export interface PersonaDraftRevisionReadCommand
{
	/** Persona profile that owns the draft revision. */
	readonly personaProfileId: string;
	/** Draft revision that may be approved. */
	readonly personaRevisionId: string;
}

/** The draft revision fields approval still needs. */
export interface PersonaDraftRevisionRecord
{
	/** Interview whose exact refresh proposal may be applied after approval. */
	readonly interviewId: string;
}

/**
 * Reads the profile, interview, and revision rows every persona lifecycle step needs.
 *
 * Every method must run inside a transaction at PostgreSQL's SERIALIZABLE isolation level. This port
 * takes no row locks of its own, so that isolation level is the only thing stopping two writers from
 * both passing their checks: a writer that would invalidate one of these reads makes the transaction
 * fail instead, as a serialization error (P2034) or a unique-key clash (P2002), which the calling use
 * case reports as its conflict outcome.
 *
 * Running these reads at a weaker isolation level loses that guarantee without any error, which is why
 * the requirement is stated here rather than left to each caller.
 *
 * @see PersonaAggregateInterviewStates
 */
export interface PersonaAggregateReadRepository
{
	/** Reads the profile matching this id, silo, and owner; null when no row matches all three. */
	readProfile(command: PersonaProfileReadCommand): Promise<PersonaProfileRecord | null>;
	/** Reads the profile matching this id and owner, returning its silo; null when no row matches. */
	readProfileForOwner(command: PersonaProfileOwnerReadCommand): Promise<PersonaProfileRecord | null>;
	/** Reads one owner interview before answer or completion mutation. */
	readInterview(command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>;
	/** Reads a completed owner interview before draft derivation. */
	readCompletedInterview(command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>;
	/** Reads one still-draft revision before approval. */
	readDraftRevision(command: PersonaDraftRevisionReadCommand): Promise<PersonaDraftRevisionRecord | null>;
	/** Returns the next revision number for a profile. Must run in the same Serializable transaction as the insert that uses it. */
	readNextRevision(personaProfileId: string): Promise<number>;
}
