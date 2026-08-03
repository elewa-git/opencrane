import { PersonalConfigurationChangeState, type Prisma } from "@prisma/client";

import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { _ResolvePersonalConfigurationMaterializationStrategy } from "./personal-configuration-materialization-strategy.js";
import { _TerminalProposalResolution } from "./personal-configuration-materialization-state.js";
import { PersonalConfigurationMaterializationLifecycleStates, type PersonalConfigurationMaterializationChange, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";
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
	async resolve(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationResolution>
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
		const materializationChange = change === null
			? null
			: { ...change, state: _MaterializationLifecycleState(change.state) } satisfies PersonalConfigurationMaterializationChange;
		return materializationChange === null
			? _TerminalProposalResolution({ status: PersonalConfigurationMaterializationCodes.NotFoundOrNotOwner })
			: _ResolvePersonalConfigurationMaterializationStrategy(materializationChange, command, this._ReadActivePersonaRevision.bind(this));
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

	/** Reads the owner-bound persona head only when the selected strategy needs freshness evidence. */
	private async _ReadActivePersonaRevision(personaProfileId: string, command: MaterializePersonalConfigurationChangeCommand): Promise<string | null>
	{
		const profile = await this.transaction.personaProfile.findFirst({
			where: {
				id: personaProfileId,
				siloId: command.siloId,
				userId: command.userId,
			},
			select: { activeRevisionId: true },
		});
		return profile?.activeRevisionId ?? null;
	}
}

/** Maps the generated database lifecycle spelling to the personal materialisation state machine. */
function _MaterializationLifecycleState(state: PersonalConfigurationChangeState): PersonalConfigurationMaterializationLifecycleStates
{
	switch (state)
	{
		case PersonalConfigurationChangeState.Proposed: return PersonalConfigurationMaterializationLifecycleStates.Proposed;
		case PersonalConfigurationChangeState.Accepted: return PersonalConfigurationMaterializationLifecycleStates.Accepted;
		case PersonalConfigurationChangeState.Applied: return PersonalConfigurationMaterializationLifecycleStates.Applied;
		case PersonalConfigurationChangeState.Rejected: return PersonalConfigurationMaterializationLifecycleStates.Rejected;
		case PersonalConfigurationChangeState.Superseded: return PersonalConfigurationMaterializationLifecycleStates.Superseded;
	}
}
