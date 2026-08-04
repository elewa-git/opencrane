/** Stable lifecycle values returned by the aggregate read port. */
export enum PersonaAggregateInterviewStates
{
	/** The owner may still append reviewed-question answers. */
	InProgress = "in_progress",
	/** The answer evidence is frozen for deterministic drafting. */
	Completed = "completed",
}

/** Coordinates that identify one owner profile inside the canonical product database. */
export interface PersonaProfileReadCommand
{
	/** Silo that owns the persona aggregate. */
	readonly siloId: string;
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** Persona profile receiving the lifecycle mutation. */
	readonly personaProfileId: string;
}

/** Coordinates that identify one owner profile where the silo is read from the owned row. */
export interface PersonaProfileOwnerReadCommand
{
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** Persona profile receiving the lifecycle mutation. */
	readonly personaProfileId: string;
}

/** Owner-profile evidence shared by persona lifecycle mutations. */
export interface PersonaProfileRecord
{
	/** Silo retained for proposal application after the profile read succeeds. */
	readonly siloId: string;
	/** Previously active immutable persona revision, if any. */
	readonly activeRevisionId: string | null;
}

/** Coordinates that identify one interview owned by the caller's profile. */
export interface PersonaInterviewReadCommand
{
	/** Persona profile that owns the interview. */
	readonly personaProfileId: string;
	/** Authenticated owner of the interview. */
	readonly userId: string;
	/** Interview being read or mutated. */
	readonly interviewId: string;
}

/** Interview evidence required by answer, completion, and draft steps. */
export interface PersonaInterviewRecord
{
	/** Reviewed question-set identifier frozen when the interview started. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version frozen when the interview started. */
	readonly questionSetVersion: number;
	/** Current durable lifecycle state. */
	readonly state: PersonaAggregateInterviewStates;
}

/** Coordinates that identify one draft revision owned by the caller's profile. */
export interface PersonaDraftRevisionReadCommand
{
	/** Persona profile that owns the draft revision. */
	readonly personaProfileId: string;
	/** Draft revision that may be approved. */
	readonly personaRevisionId: string;
}

/** Draft evidence needed to finish approval. */
export interface PersonaDraftRevisionRecord
{
	/** Interview whose exact refresh proposal may be applied after approval. */
	readonly interviewId: string;
}

/**
 * Typed persona-aggregate read port for all lifecycle evidence and latest-revision operations.
 *
 * Every method must run inside a Serializable transaction: the repository takes no row locks, so
 * concurrent writers that would invalidate a read surface as serialization or unique-key failures
 * that the owning authority translates into its explicit conflict outcome.
 */
export interface PersonaAggregateReadRepository
{
	/** Reads an exact profile with a silo and owner proof. */
	readProfile(client: unknown, command: PersonaProfileReadCommand): Promise<PersonaProfileRecord | null>;
	/** Reads an owner profile while returning its durable silo coordinate. */
	readProfileForOwner(client: unknown, command: PersonaProfileOwnerReadCommand): Promise<PersonaProfileRecord | null>;
	/** Reads one owner interview before answer or completion mutation. */
	readInterview(client: unknown, command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>;
	/** Reads a completed owner interview before draft derivation. */
	readCompletedInterview(client: unknown, command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>;
	/** Reads one still-draft revision before approval. */
	readDraftRevision(client: unknown, command: PersonaDraftRevisionReadCommand): Promise<PersonaDraftRevisionRecord | null>;
	/** Reads the next profile-local revision inside the same serializable transaction as its insert. */
	readNextRevision(client: unknown, personaProfileId: string): Promise<number>;
}
