import { PersonaRevisionState, type Prisma } from "@prisma/client";

import type { RuntimePersonaEffectEligibility, RuntimePersonaEffectEligibilityCommand } from "./runtime-persona-effect-eligibility.types";

/** Reads the current active Persona revision on the runtime effect transaction. */
export class PrismaRuntimePersonaEffectEligibilityAuthority implements RuntimePersonaEffectEligibility
{
	/** Transaction shared with the ToolInvocation admission. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds Persona lifecycle reads to the caller's open transaction.
	 *
	 * Called by: the OpenCrane runtime composition when it builds external-effect admission.
	 * @param transaction - Transaction that will also persist the admitted ToolInvocation.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async findEligibleProfileId(command: RuntimePersonaEffectEligibilityCommand): Promise<string | null>
	{
		const revision = await this.transaction.personaRevision.findFirst({
			where: {
				id: command.personaRevisionId,
				state: PersonaRevisionState.Approved,
				profile: { is: { siloId: command.siloId, userId: command.userId, activeRevisionId: command.personaRevisionId } },
			},
			select: { personaProfileId: true },
		});
		return revision?.personaProfileId ?? null;
	}
}
