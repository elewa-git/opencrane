import type { AgentRevisionModelSelectionRepository } from "@opencrane/backend/server/agents/agent-services";

import type { MaterializePersonalConfigurationChangeCommand, PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import type { ProposalResolutionResult } from "./personal-configuration-materialization-repository.types.js";

/** Personal proposal persistence operations that participate in materialisation. */
export interface PersonalConfigurationMaterializationRepository
{
	/** Resolves owner, lifecycle, patch, and persona evidence from one transaction snapshot. */
	resolve(command: MaterializePersonalConfigurationChangeCommand): Promise<ProposalResolutionResult>;
	/** Applies the final proposal compare-and-set after agent-services prepared its revision. */
	apply(command: MaterializePersonalConfigurationChangeCommand, agentRevisionId: string): Promise<PersonalConfigurationMaterializationPersistenceResult>;
}

/** Capability repositories bound to one materialisation transaction. */
export interface PersonalConfigurationMaterializationTransaction
{
	/** Proposal-journal repository owned by personal configuration. */
	readonly proposals: PersonalConfigurationMaterializationRepository;
	/** Agent-revision repository owned by agent-services. */
	readonly agentRevisions: AgentRevisionModelSelectionRepository;
}

/** Work executed atomically against transaction-scoped capability repositories. */
export type PersonalConfigurationMaterializationWork<Result> = (transaction: PersonalConfigurationMaterializationTransaction) => Promise<Result>;

/** Unit-of-work seam for one complete cross-domain personal configuration change. */
export interface PersonalConfigurationMaterializationUnitOfWork
{
	/** Runs the complete work at Serializable isolation with bounded conflict retries. */
	run<Result>(work: PersonalConfigurationMaterializationWork<Result>): Promise<Result>;
}
