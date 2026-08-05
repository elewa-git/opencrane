import { PersonalConfigurationChangeState, type Prisma } from "@prisma/client";

import { AgentConfigPatchKinds } from "@opencrane/contracts";

import { PersonalConfigurationPersonaRefreshClaimCodes, type AcceptedPersonaRefreshCommand, type PersonalConfigurationPersonaRefreshRepository } from "./personal-configuration-persona-refresh.types.js";

/** Transaction-scoped configuration repository that owns all PersonalConfigurationChange state access. */
export class PrismaPersonalConfigurationPersonaRefreshRepository implements PersonalConfigurationPersonaRefreshRepository
{
	/** Transaction that bounds persona and configuration mutations together. */
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

	/** Applies only the still-accepted persona-refresh proposal attached to the approved revision. */
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
