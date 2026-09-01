import type { JsonValue } from "@opencrane/util";

/** Authenticated local Principal coordinates used by persona product authorization. */
export interface PersonaProductAuthorizationCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Stable local Principal resolved during authenticated request admission. */
	readonly principalId: string;
}

/** Central persona decisions available inside one owning domain transaction. */
export interface PersonaProductAuthorizationRepository
{
	/** Returns whether the caller can read one owner-narrowed persona profile. */
	canRead(caller: PersonaProductAuthorizationCaller, personaProfileId: string): Promise<boolean>;
	/** Records one persona profile mutation admission before the protected write. */
	admitEdit(caller: PersonaProductAuthorizationCaller, personaProfileId: string, argumentsValue: JsonValue): Promise<boolean>;
	/** Records permission to create a personal persona before a profile identifier exists. */
	admitCollectionCreate(caller: PersonaProductAuthorizationCaller): Promise<boolean>;
	/** Projects the exact creator permissions for one newly created personal persona profile. */
	reconcileCreator(caller: PersonaProductAuthorizationCaller, personaProfileId: string, now: Date): Promise<void>;
}

/** Builds persona product authorization over an operation's exact Prisma transaction. */
export interface PersonaProductAuthorizationFactory<Transaction = unknown>
{
	/** Creates the transaction-scoped persona authority adapter. */
	create(transaction: Transaction): PersonaProductAuthorizationRepository;
}
