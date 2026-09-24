import type { Prisma } from "@prisma/client";

import { PrismaMcpConnectionReadinessRepository } from "../connections/prisma-mcp-connection-readiness-repository";
import type { RuntimeMcpEffectEligibility, RuntimeMcpEffectEligibilityCommand } from "./runtime-mcp-effect-eligibility.types";

/** Reads current MCP assignment and connection readiness for runtime effect admission. */
export class PrismaRuntimeMcpEffectEligibilityAuthority implements RuntimeMcpEffectEligibility
{
	/** Transaction shared with the ToolInvocation admission. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds MCP lifecycle reads to the caller's open transaction.
	 *
	 * Called by: the OpenCrane runtime composition when it builds external-effect admission.
	 * @param transaction - Transaction that will also persist the admitted ToolInvocation.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async isEligible(command: RuntimeMcpEffectEligibilityCommand): Promise<boolean>
	{
		const assignment = await this.transaction.agentRevisionMcpToolAssignment.findFirst({
			where: {
				agentRevisionId: command.agentRevisionId,
				agentServiceId: command.agentServiceId,
				toolRevisionId: command.toolRevisionId,
				siloId: command.siloId,
			},
			select: { agentRevisionId: true },
		});
		if (assignment === null)
			return false;
		const readiness = new PrismaMcpConnectionReadinessRepository(this.transaction);
		return readiness.isReady({ siloId: command.siloId, toolRevisionId: command.toolRevisionId, ownerPrincipalId: command.ownerPrincipalId });
	}
}
