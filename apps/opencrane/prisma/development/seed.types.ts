import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/** Provides the Prisma upsert used for mutable local-development seed rows. */
interface LocalDevelopmentSeedUpsertDelegate
{
	/** Creates the stable row or updates the existing row selected by its unique key. */
	upsert(input: unknown): Promise<unknown>;
}

/** Represents the latest immutable membership revision before the seed appends its successor. */
interface LocalDevelopmentSeedRevisionRow
{
	/** Identifies the revision's position within one issuer-and-silo history. */
	readonly revision: number;
}

/** Provides the Prisma operations that append revisions without mutating prior evidence. */
interface LocalDevelopmentSeedRevisionDelegate
{
	/** Reads the newest revision for the fixed local issuer and silo. */
	findFirst(input: unknown): Promise<LocalDevelopmentSeedRevisionRow | null>;
	/** Appends a newly signed immutable revision. */
	create(input: unknown): Promise<unknown>;
}

/** Provides the Prisma operation that appends the assertion belonging to a new revision. */
interface LocalDevelopmentSeedAssertionDelegate
{
	/** Appends an immutable subject assertion. */
	create(input: unknown): Promise<unknown>;
}

/** Groups the transaction-scoped delegates that own each local identity and model seed write. */
interface LocalDevelopmentSeedTransaction
{
	readonly principal: LocalDevelopmentSeedUpsertDelegate;
	readonly orgMembership: LocalDevelopmentSeedUpsertDelegate;
	readonly verifiedFleetMembershipRevision: LocalDevelopmentSeedRevisionDelegate;
	readonly verifiedFleetMembershipAssertion: LocalDevelopmentSeedAssertionDelegate;
	readonly modelDefinition: LocalDevelopmentSeedUpsertDelegate;
	readonly modelRoutingDefault: LocalDevelopmentSeedUpsertDelegate;
}

/**
 * Provides the transaction and disconnect operations used by the app-owned seed entrypoint. Tests
 * replace this port to prove replay behavior without opening PostgreSQL.
 */
export interface LocalDevelopmentSeedDatabase
{
	/** Runs every seed write in one atomic transaction. */
	$transaction(operation: (transaction: LocalDevelopmentSeedTransaction) => Promise<void>): Promise<void>;
	/** Releases the seed connection before the watched server starts. */
	$disconnect(): Promise<void>;
}

/**
 * Supplies the environment checks, signing operation, and database client required by the Tier 2
 * seed. `_RunLocalDevelopmentSeed` uses the production implementation; replay tests replace all
 * three operations to observe transaction order and allocated revision numbers.
 */
export interface LocalDevelopmentSeedDependencies
{
	/** Refuses a database outside the local development boundary. */
	assertLocalDatabase(): void;
	/**
	 * Creates the signed membership revision written with the fixed local identity.
	 * @param revision - Next issuer-and-silo revision allocated inside the seed transaction.
	 * @returns Signed evidence whose revision and database identifier use the allocated number.
	 */
	createMembership(revision: number): SignedFleetMembershipRevision;
	/** Opens the Prisma client whose transaction owns every seed write. */
	createPrisma(): LocalDevelopmentSeedDatabase;
}
