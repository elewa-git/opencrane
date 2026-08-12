import { ___CreateLogger, type Logger } from "@opencrane/backend/observability";
import { AgentRevisionModelSelectionMaterializationCodes } from "@opencrane/backend/server/agents/agent-services";

import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type PersonalConfigurationChangeMaterializationRepository, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { PersonalConfigurationMaterializationResolutionOutcomes } from "./personal-configuration-materialization-state.types.js";
import type { PersonalConfigurationMaterializationTransaction, PersonalConfigurationMaterializationUnitOfWork } from "./personal-configuration-materialization-unit-of-work.types.js";

/**
 * Applies an accepted proposal by driving this package's repository and agent-services' revision
 * repository inside one transaction.
 *
 * The only place the two domains are sequenced. It owns the order of operations and the
 * translation of every failure into a stable result; the transaction, isolation level and
 * retries belong to the unit of work it is given.
 *
 * Constructed by: `_CreatePersonalConfigurationRouter`.
 *
 * @implements PersonalConfigurationChangeMaterializationRepository
 */
export class _PersonalConfigurationMaterializer implements PersonalConfigurationChangeMaterializationRepository
{
	/** Opens the transaction each attempt runs in; supplied by the Prisma composition. */
	private readonly unitOfWork: PersonalConfigurationMaterializationUnitOfWork;
	/** Logger for a failure that survives every retry; proposal contents are never logged. */
	private readonly logger: Logger;

	/** Creates the repository-driven application materializer. */
	constructor(unitOfWork: PersonalConfigurationMaterializationUnitOfWork, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.unitOfWork = unitOfWork;
		this.logger = logger;
	}

	/**
	 * Applies one accepted proposal, using both repositories inside one transaction.
	 *
	 * The order is deliberate and must not be rearranged. The proposal and its persona revision
	 * are read first, so a replay or a refusal costs no revision work. Agent-services then creates
	 * the new revision. The proposal's compare-and-set runs last: if it loses, or if the database
	 * trigger rejects it because the persona revision moved on, it throws, and everything
	 * agent-services already wrote rolls back with it. That is why no revision can exist for a
	 * proposal that is not Applied.
	 *
	 * @param command - Server-derived owner, proposal id and time.
	 * @returns `Applied` with the new revision id; `NotApplicable` for a persona refresh;
	 * `StaleProposal` or `ModelUnavailable` when agent-services refuses; or
	 * `PersistenceUnavailable` when the transaction failed after the unit of work used up its
	 * retries. Never throws: the failure is logged once here and returned as a result.
	 */
	async materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>
	{
		try
		{
			return await this.unitOfWork.run(async function _Materialize(transaction: PersonalConfigurationMaterializationTransaction): Promise<PersonalConfigurationMaterializationPersistenceResult>
			{
				// 1. Read the owner, the proposal's state, and its persona revision before writing anything.
				const resolution = await transaction.proposals.resolve(command);
				if (resolution.outcome === PersonalConfigurationMaterializationResolutionOutcomes.Terminal) return resolution.result;

				// 2. Ask the agent-service repository to create the revision with the chosen model.
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

				// 3. Do the proposal's compare-and-set last, so if it loses, the new revision rolls back with it.
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
