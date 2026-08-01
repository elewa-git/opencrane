/** Coordinates that identify one owner profile inside the canonical product database. */
export interface PersonaProfileLockCommand
{
	/** Silo that owns the persona aggregate. */
	readonly siloId: string;
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** Persona profile receiving the lifecycle mutation. */
	readonly personaProfileId: string;
}

/** Coordinates that identify one owner profile where the silo is read from the locked row. */
export interface PersonaProfileOwnerLockCommand
{
	/** Authenticated owner of the aggregate. */
	readonly userId: string;
	/** Persona profile receiving the lifecycle mutation. */
	readonly personaProfileId: string;
}

/** Locked profile coordinates shared by persona lifecycle mutations. */
export interface PersonaProfileLock
{
	/** Silo retained for proposal application after the profile lock succeeds. */
	readonly siloId: string;
	/** Previously active immutable persona revision, if any. */
	readonly activeRevisionId: string | null;
}

/** Coordinates that identify one interview owned by an already locked profile. */
export interface PersonaInterviewLockCommand
{
	/** Persona profile that owns the interview. */
	readonly personaProfileId: string;
	/** Authenticated owner of the interview. */
	readonly userId: string;
	/** Interview being read or mutated. */
	readonly interviewId: string;
}

/** Locked interview evidence required by answer, completion, and draft steps. */
export interface PersonaInterviewLock
{
	/** Reviewed question-set identifier frozen when the interview started. */
	readonly questionSetId: string;
	/** Exact reviewed question-set version frozen when the interview started. */
	readonly questionSetVersion: number;
	/** Current durable lifecycle state. */
	readonly state: string;
}

/** Coordinates that identify one draft revision owned by a locked profile. */
export interface PersonaDraftRevisionLockCommand
{
	/** Persona profile that owns the draft revision. */
	readonly personaProfileId: string;
	/** Draft revision that may be approved. */
	readonly personaRevisionId: string;
}

/** Locked draft evidence needed to finish approval. */
export interface PersonaDraftRevisionLock
{
	/** Interview whose exact refresh proposal may be applied after approval. */
	readonly interviewId: string;
}

/** Typed persona-aggregate persistence port for all lifecycle lock and latest-revision operations. */
export interface PersonaAggregateLockRepository
{
	/** Locks an exact profile with a silo and owner proof. */
	lockProfile(client: unknown, command: PersonaProfileLockCommand): Promise<PersonaProfileLock | null>;
	/** Locks an owner profile while returning its durable silo coordinate. */
	lockProfileForOwner(client: unknown, command: PersonaProfileOwnerLockCommand): Promise<PersonaProfileLock | null>;
	/** Locks one owner interview before answer or completion mutation. */
	lockInterview(client: unknown, command: PersonaInterviewLockCommand): Promise<PersonaInterviewLock | null>;
	/** Locks a completed owner interview before draft derivation. */
	lockCompletedInterview(client: unknown, command: PersonaInterviewLockCommand): Promise<PersonaInterviewLock | null>;
	/** Locks one still-draft revision before approval. */
	lockDraftRevision(client: unknown, command: PersonaDraftRevisionLockCommand): Promise<PersonaDraftRevisionLock | null>;
	/** Reads the next profile-local revision while the caller holds the profile lock. */
	readNextRevision(client: unknown, personaProfileId: string): Promise<number>;
}
