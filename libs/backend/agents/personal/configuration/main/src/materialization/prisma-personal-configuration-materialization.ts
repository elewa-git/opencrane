import { PersonalConfigurationChangeState, type Prisma } from "@prisma/client";

import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { ProposalResolutionOutcomes, type ProposalResolutionResult } from "./personal-configuration-materialization-repository.types.js";
import type { PersonalConfigurationMaterializationRepository } from "./personal-configuration-materialization-unit-of-work.types.js";

/** Prisma repository for proposal evidence and the final application fence. */
export class PrismaPersonalConfigurationMaterializationRepository implements PersonalConfigurationMaterializationRepository
{
	/** Transaction-scoped ORM client supplied only by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the transaction-scoped proposal repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Resolves owner, lifecycle, patch, and persona evidence from one serializable snapshot. */
	async resolve(command: MaterializePersonalConfigurationChangeCommand): Promise<ProposalResolutionResult>
	{
		const change = await this.transaction.personalConfigurationChange.findFirst({
			where: {
				id: command.changeId,
				siloId: command.siloId,
				userId: command.userId,
			},
			select: {
				state: true,
				personaProfileId: true,
				agentServiceId: true,
				expectedPersonaRevisionId: true,
				expectedAgentRevisionId: true,
				requestedPatch: true,
				appliedAgentRevisionId: true,
			},
		});
		if (change === null) return _Terminal({ status: PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner });

		const patch = change.requestedPatch as unknown;
		if (!_IsPersonalConfigurationPatch(patch) || patch.kind !== AgentConfigPatchKinds.ModelAlias)
		{
			return _Terminal({ status: PersonalConfigurationMaterializationCodes.NotApplicable });
		}
		if (change.state === PersonalConfigurationChangeState.Applied && change.appliedAgentRevisionId !== null)
		{
			return _Terminal({
				status: PersonalConfigurationMaterializationCodes.Applied,
				agentRevisionId: change.appliedAgentRevisionId,
			});
		}
		if (change.state !== PersonalConfigurationChangeState.Accepted)
		{
			return _Terminal({ status: PersonalConfigurationMaterializationCodes.NotAccepted });
		}

		const profile = await this.transaction.personaProfile.findFirst({
			where: {
				id: change.personaProfileId,
				siloId: command.siloId,
				userId: command.userId,
			},
			select: { activeRevisionId: true },
		});
		if (change.expectedAgentRevisionId === null || profile?.activeRevisionId !== change.expectedPersonaRevisionId)
		{
			return _Terminal({ status: PersonalConfigurationMaterializationCodes.StaleProposal });
		}

		return {
			outcome: ProposalResolutionOutcomes.Ready,
			proposal: {
				agentServiceId: change.agentServiceId,
				expectedAgentRevisionId: change.expectedAgentRevisionId,
				expectedPersonaRevisionId: change.expectedPersonaRevisionId,
				modelAlias: patch.modelAlias.trim(),
			},
		};
	}

	/**
	 * Applies the exact still-accepted owner proposal after agent-services prepares its revision.
	 *
	 * The target-database lifecycle trigger locks the referenced persona profile and rejects this
	 * transition if its active revision no longer matches the proposal. Throwing on a lost compare-
	 * and-set forces the owning unit of work to roll every agent-service mutation back as well.
	 */
	async apply(command: MaterializePersonalConfigurationChangeCommand, revisionId: string): Promise<PersonalConfigurationMaterializationPersistenceResult>
	{
		const applied = await this.transaction.personalConfigurationChange.updateMany({
			where: {
				id: command.changeId,
				siloId: command.siloId,
				userId: command.userId,
				state: PersonalConfigurationChangeState.Accepted,
			},
			data: {
				state: PersonalConfigurationChangeState.Applied,
				appliedAgentRevisionId: revisionId,
			},
		});
		if (applied.count !== 1)
		{
			throw new Error("personal configuration proposal lost its accepted state during materialization");
		}
		return { status: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: revisionId };
	}
}

/** Wraps a terminal materialisation result for the proposal-resolution result. */
function _Terminal(result: PersonalConfigurationMaterializationPersistenceResult): { readonly outcome: ProposalResolutionOutcomes.Terminal; readonly result: PersonalConfigurationMaterializationPersistenceResult }
{
	return { outcome: ProposalResolutionOutcomes.Terminal, result };
}
