import { PersonalConfigurationChangeState, type Prisma } from "@prisma/client";

import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { _ResolvePersonalConfigurationMaterializationStrategy } from "./personal-configuration-materialization-strategy.js";
import { _TerminalProposalResolution } from "./personal-configuration-materialization-state.js";
import { PersonalConfigurationMaterializationLifecycleStates, type PersonalConfigurationMaterializationChange, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";
import type { PersonalConfigurationMaterializationRepository } from "./personal-configuration-materialization-unit-of-work.types.js";

/**
 * Reads a proposal for materialisation and, at the end, marks it applied.
 *
 * Takes a transaction client only, so both operations run in the materialisation transaction
 * alongside agent-services' writes.
 *
 * Constructed by: {@link PrismaPersonalConfigurationMaterializationUnitOfWork.run}.
 *
 * @implements PersonalConfigurationMaterializationRepository
 */
export class PrismaPersonalConfigurationMaterializationRepository implements PersonalConfigurationMaterializationRepository
{
	/** Transaction-scoped ORM client supplied only by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the transaction-scoped proposal repository. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Reads the proposal for this owner and hands it to the strategy for its patch kind.
	 *
	 * @param command - Server-derived owner, proposal id and time.
	 * @returns `Terminal` with `NotFoundOrNotOwner` when no proposal matches this user and silo —
	 * the same answer given for another owner's proposal — otherwise whatever the patch kind's
	 * strategy decides. Writes nothing either way.
	 */
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
	 * Moves the proposal to Applied, only while it is still Accepted, after agent-services has
	 * created the revision.
	 *
	 * The database's lifecycle trigger locks the persona profile and rejects this update if its
	 * active revision no longer matches the proposal, so a change can never be applied to an agent
	 * the user did not review.
	 *
	 * @param command - Server-derived owner, proposal id and time.
	 * @param revisionId - The revision agent-services just created.
	 * @returns `Applied` with that revision id.
	 * @throws Error when the update matched no row. Throwing rather than returning is deliberate:
	 * it makes the unit of work roll every agent-service write back as well, so no revision is
	 * left behind for a proposal that was never applied.
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

	/** Reads this owner's active persona revision; only a strategy that needs it calls this. */
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

/** Converts Prisma's state value to this package's own state enum. */
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
