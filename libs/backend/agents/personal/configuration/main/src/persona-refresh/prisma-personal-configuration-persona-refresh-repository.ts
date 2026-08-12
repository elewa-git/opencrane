import { PersonalConfigurationChangeState, type Prisma } from "@prisma/client";

import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { PersonalConfigurationPersonaRefreshClaimCodes, type AcceptedPersonaRefreshCommand, type PersonalConfigurationPersonaRefreshRepository } from "./personal-configuration-persona-refresh.types.js";

/**
 * The only place a persona refresh reads or writes PersonalConfigurationChange rows.
 *
 * Constructed inside the personas package's own transaction, so a persona revision and the
 * proposal it satisfies commit together or not at all.
 *
 * Constructed by: `PrismaPersonaInterviewRepository` and `PrismaPersonaAuthorityRepository` in
 * libs/backend/agents/personal/personas/main/src.
 *
 * @implements PersonalConfigurationPersonaRefreshRepository
 */
export class PrismaPersonalConfigurationPersonaRefreshRepository implements PersonalConfigurationPersonaRefreshRepository
{
	/** The caller's transaction, so persona and proposal changes commit together. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds proposal operations to one caller-owned transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Locks and verifies the exact accepted persona-refresh proposal. */
	async claimAcceptedPersonaRefresh(command: AcceptedPersonaRefreshCommand): Promise<PersonalConfigurationPersonaRefreshClaimCodes>
	{
		const change = await this.transaction.personalConfigurationChange.findFirst({
			where: {
				id: command.configurationChangeId,
				siloId: command.siloId,
				userId: command.userId,
				personaProfileId: command.personaProfileId,
				state: PersonalConfigurationChangeState.Accepted,
				requestedPatch: { equals: { kind: AgentConfigPatchKinds.PersonaRefresh } },
			},
			select: { id: true },
		});
		return change === null ? PersonalConfigurationPersonaRefreshClaimCodes.Unavailable : PersonalConfigurationPersonaRefreshClaimCodes.Accepted;
	}

	/** Marks the proposal applied only while it is still accepted, and records the approved persona revision. */
	async applyApprovedPersonaRefresh(command: AcceptedPersonaRefreshCommand & { readonly personaRevisionId: string }): Promise<boolean>
	{
		const updated = await this.transaction.personalConfigurationChange.updateMany({
			where: {
				id: command.configurationChangeId,
				siloId: command.siloId,
				userId: command.userId,
				personaProfileId: command.personaProfileId,
				state: PersonalConfigurationChangeState.Accepted,
				requestedPatch: { equals: { kind: AgentConfigPatchKinds.PersonaRefresh } },
			},
			data: {
				state: PersonalConfigurationChangeState.Applied,
				appliedPersonaRevisionId: command.personaRevisionId,
			},
		});
		return updated.count === 1;
	}
}
