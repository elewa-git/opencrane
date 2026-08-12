import type { ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";

/** Durable identifier returned after the database accepts one proposal insert. */
export interface PersonalConfigurationProposalPersistenceReceipt
{
	/** Identifier of the immutable proposal journal row. */
	readonly changeId: string;
}

/** Transaction-scoped repository for configuration-proposal provenance and insertion. */
export interface PersonalConfigurationProposalRepository
{
	/** Inserts immutable evidence through the database-owned provenance authority. */
	propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceReceipt>;
}
