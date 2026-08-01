import { ___CreateLogger, type Logger } from "@opencrane/observability";
import { AgentRevisionModelSelectionMaterializationCodes } from "@opencrane/backend/server/agents/agent-services";

import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type PersonalConfigurationChangeMaterializationRepository, type PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";
import { ProposalResolutionOutcomes } from "./personal-configuration-materialization-repository.types.js";
import type { PersonalConfigurationMaterializationTransaction, PersonalConfigurationMaterializationUnitOfWork } from "./personal-configuration-materialization-unit-of-work.types.js";

/** Application materializer that coordinates capability repositories through one unit of work. */
export class _PersonalConfigurationMaterializer implements PersonalConfigurationChangeMaterializationRepository
{
	/** Transaction boundary supplied by the Prisma composition. */
	private readonly unitOfWork: PersonalConfigurationMaterializationUnitOfWork;
	/** Redacted structured failure logger for final materialisation failures. */
	private readonly logger: Logger;

	/** Creates the repository-driven application materializer. */
	constructor(unitOfWork: PersonalConfigurationMaterializationUnitOfWork, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.unitOfWork = unitOfWork;
		this.logger = logger;
	}

	/**
	 * Applies one accepted proposal through transaction-scoped capability repositories.
	 *
	 * Proposal/persona evidence is resolved before agent-services mutates its revision lineage. The
	 * final proposal compare-and-set runs last, so losing either application or trigger fence rolls
	 * back the complete cross-domain unit of work. Persistence failures retain the public fail-closed
	 * result and are logged only after the unit of work exhausts its bounded retries.
	 */
	async materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>
	{
		try
		{
			return await this.unitOfWork.run(async function _Materialize(transaction: PersonalConfigurationMaterializationTransaction): Promise<PersonalConfigurationMaterializationPersistenceResult>
			{
				// 1. Resolve owner, proposal lifecycle, and persona evidence before cross-domain writes.
				const resolution = await transaction.proposals.resolve(command);
				if (resolution.outcome === ProposalResolutionOutcomes.Terminal) return resolution.result;

				// 2. Ask the agent-service repository to prepare the exact selected-model revision.
				const proposal = resolution.proposal;
				const materialized = await transaction.agentRevisions.materialize({
					siloId: command.siloId,
					agentServiceId: proposal.agentServiceId,
					expectedSourceRevisionId: proposal.expectedAgentRevisionId,
					expectedPersonaRevisionId: proposal.expectedPersonaRevisionId,
					modelAlias: proposal.modelAlias,
					changeMessage: `Owner accepted model alias: ${proposal.modelAlias}`,
					authoredBy: command.userId,
					materializedAt: new Date(command.materializedAt),
				});
				if (materialized.status === AgentRevisionModelSelectionMaterializationCodes.StaleSource)
				{
					return { status: PersonalConfigurationMaterializationCodes.StaleProposal };
				}
				if (materialized.status === AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable)
				{
					return { status: PersonalConfigurationMaterializationCodes.ModelUnavailable };
				}

				// 3. Apply the final proposal CAS last so any lost fence rolls all prepared writes back.
				return transaction.proposals.apply(command, materialized.agentRevisionId);
			});
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.materialize", siloId: command.siloId, changeId: command.changeId }, "Personal configuration materialization failed");
			return { status: PersonalConfigurationMaterializationCodes.PersistenceUnavailable };
		}
	}
}
