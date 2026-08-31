import { AgentRevisionState, AgentServiceKind, AgentServiceState, type Prisma } from "@prisma/client";

import type { RuntimeAgentEffectEligibility, RuntimeAgentEffectEligibilityCommand } from "../runtime-agent-effect-eligibility.types";

/** Reads the AgentService lifecycle on the transaction that admits a runtime effect. */
export class PrismaRuntimeAgentEffectEligibilityAuthority implements RuntimeAgentEffectEligibility
{
	/** Transaction shared with the ToolInvocation admission. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds lifecycle reads to the caller's open transaction.
	 *
	 * Called by: the OpenCrane runtime composition when it builds external-effect admission.
	 * @param transaction - Transaction that will also persist the admitted ToolInvocation.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async isEligible(command: RuntimeAgentEffectEligibilityCommand): Promise<boolean>
	{
		const expectedKind = command.executionKind === "personal" ? AgentServiceKind.Personal : AgentServiceKind.Managed;
		const service = await this.transaction.agentService.findFirst({
			where: {
				id: command.agentServiceId,
				siloId: command.siloId,
				kind: expectedKind,
				state: AgentServiceState.Active,
				activeRevisionId: command.agentRevisionId,
				...(command.executionKind === "managed" ? { principalId: command.principalId } : {}),
				activeRevision: { is: { id: command.agentRevisionId, state: AgentRevisionState.Published } },
			},
			select: { id: true },
		});
		return service !== null;
	}
}
