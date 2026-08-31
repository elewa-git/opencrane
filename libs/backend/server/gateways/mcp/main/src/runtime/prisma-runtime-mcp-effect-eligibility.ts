import { McpApprovalStatus, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";

import type { RuntimeMcpEffectEligibility, RuntimeMcpEffectEligibilityCommand } from "./runtime-mcp-effect-eligibility.types";

/** Reads current MCP publication and revision assignment for runtime effect admission. */
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
				toolRevision: {
					is: {
						serverRevision: {
							is: {
								state: McpServerRevisionState.Ready,
								server: { is: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } },
							},
						},
					},
			},
			},
			select: { agentRevisionId: true },
		});
		return assignment !== null;
	}
}
