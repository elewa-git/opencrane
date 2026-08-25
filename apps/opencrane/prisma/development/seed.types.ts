import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/** Minimal Prisma delegate used by the replay-safe local seed. */
export interface LocalDevelopmentSeedUpsertDelegate
{
	/** Creates the stable row or updates the existing row selected by its unique key. */
	upsert(input: unknown): Promise<unknown>;
}

/** Transaction-scoped delegates that own every local identity and model seed write. */
export interface LocalDevelopmentSeedTransaction
{
	readonly principal: LocalDevelopmentSeedUpsertDelegate;
	readonly orgMembership: LocalDevelopmentSeedUpsertDelegate;
	readonly verifiedFleetMembershipRevision: LocalDevelopmentSeedUpsertDelegate;
	readonly verifiedFleetMembershipAssertion: LocalDevelopmentSeedUpsertDelegate;
	readonly modelDefinition: LocalDevelopmentSeedUpsertDelegate;
	readonly modelRoutingDefault: LocalDevelopmentSeedUpsertDelegate;
}

/** Database lifecycle used by the app-owned seed entrypoint. */
export interface LocalDevelopmentSeedDatabase
{
	/** Runs every seed write in one atomic transaction. */
	$transaction(operation: (transaction: LocalDevelopmentSeedTransaction) => Promise<void>): Promise<void>;
	/** Releases the seed connection before the watched server starts. */
	$disconnect(): Promise<void>;
}

/** Injected authorities required to run the Tier 2 database seed. */
export interface LocalDevelopmentSeedDependencies
{
	/** Refuses a database outside the local development boundary. */
	assertLocalDatabase(): void;
	/** Creates the signed membership revision written with the fixed local identity. */
	createMembership(): SignedFleetMembershipRevision;
	/** Opens the Prisma client whose transaction owns every seed write. */
	createPrisma(): LocalDevelopmentSeedDatabase;
}
