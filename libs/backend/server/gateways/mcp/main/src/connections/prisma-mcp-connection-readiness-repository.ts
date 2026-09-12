import { McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";

import { MCP_ERA_PROTOCOL_VERSION } from "../era-probe/mcp-era-probe.types";
import type { McpConnectionReadiness, McpConnectionReadinessCommand } from "./mcp-connection-readiness.types";

/** Owns the exact server and installation checks that make an MCP effect credentialless. */
export class PrismaMcpConnectionReadinessRepository implements McpConnectionReadiness
{
	/** Prisma client for the caller's open transaction. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind every readiness read or claim to the transaction that admits the effect. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** @inheritdoc */
	async isReady(command: McpConnectionReadinessCommand): Promise<boolean>
	{
		const install = await this._transaction.mcpServerInstall.findFirst({
			where: _ReadyInstall(command),
			select: { id: true },
		});
		return install !== null;
	}

	/** @inheritdoc */
	async lockForDispatch(command: McpConnectionReadinessCommand): Promise<boolean>
	{
		const locked = await this._transaction.mcpServerInstall.updateMany({
			where: _ReadyInstall(command),
			data: { connectionStatus: McpConnectionStatus.Credentialless },
		});
		return locked.count === 1;
	}
}

/** Bind an installation to the exact usable tool and server without inferring from presentation. */
function _ReadyInstall(command: McpConnectionReadinessCommand): Prisma.McpServerInstallWhereInput
{
	return {
		principalId: command.ownerPrincipalId,
		connectionStatus: McpConnectionStatus.Credentialless,
		mcpServer: {
			is: {
				siloId: command.siloId,
				credentialRequirement: McpCredentialRequirement.Credentialless,
				status: McpServerStatus.Active,
				approvalStatus: McpApprovalStatus.Published,
				revisions: {
					some: {
						state: McpServerRevisionState.Ready,
						protocolVersion: MCP_ERA_PROTOCOL_VERSION,
						tools: { some: { id: command.toolRevisionId, siloId: command.siloId } },
					},
				},
			},
		},
	};
}
