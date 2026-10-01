import type { Prisma } from "@prisma/client";

import type { McpInstallAuditRepository } from "../mcp-connection.types";

/** Appends install-removal audit records inside the connection admission transaction. */
export class PrismaMcpInstallAuditRepository implements McpInstallAuditRepository
{
	constructor(private readonly _transaction: Prisma.TransactionClient) {}

	async appendUninstalled(siloId: string, serverId: string, ownerPrincipalId: string, actorPrincipalId: string): Promise<void>
	{
		await this._transaction.auditEntry.create({ data: { siloId, action: "Deleted", resource: `McpServerInstall/${serverId}:${ownerPrincipalId}`, message: `MCP server ${serverId} uninstalled for ${ownerPrincipalId}`, metadata: { actorPrincipalId } } });
	}
}
