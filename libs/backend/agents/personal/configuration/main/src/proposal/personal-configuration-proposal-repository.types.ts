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
