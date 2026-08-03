import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";

/** Result produced while the proposal transaction still owns its evidence snapshot. */
export type PersonalConfigurationProposalPersistenceResult =
	| { readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string }
	| { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict };

/** Transaction-scoped repository for configuration-proposal provenance and insertion. */
export interface PersonalConfigurationProposalRepository
{
	/** Verifies every source coordinate and inserts the immutable proposal in the same transaction. */
	propose(command: ProposePersonalConfigurationChangeCommand): Promise<PersonalConfigurationProposalPersistenceResult>;
}

/** Repositories sharing one proposal transaction. */
export interface PersonalConfigurationProposalTransaction
{
	/** Proposal journal owned by personal configuration. */
	readonly proposals: PersonalConfigurationProposalRepository;
}

/** Work executed against the proposal transaction's repository set. */
export type PersonalConfigurationProposalWork<Result> = (transaction: PersonalConfigurationProposalTransaction) => Promise<Result>;

/** Unit-of-work boundary for one provenance-bound proposal insertion. */
export interface PersonalConfigurationProposalUnitOfWork
{
	/** Runs one proposal operation against a single canonical database snapshot. */
	run<Result>(work: PersonalConfigurationProposalWork<Result>): Promise<Result>;
}
