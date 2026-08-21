import type { Prisma } from "@prisma/client";

import type { McpOperatorInstallRecord, McpOperatorPrincipalRecord, McpOperatorRepository, McpOperatorServerRecord } from "./mcp-operator-repository.types";

const _SERVER_SELECT = { id: true, name: true, description: true, publisher: true, glyph: true, serverType: true, approvalStatus: true, credentialSchema: true, entitlementSummary: true } as const satisfies Prisma.McpServerSelect;

/** Transaction-scoped Prisma adapter for MCP product authority. */
export class PrismaMcpOperatorRepository implements McpOperatorRepository
{
	private readonly _transaction: Prisma.TransactionClient;

	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	async listPublishedServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>
	{
		return this._transaction.mcpServer.findMany({ where: { siloId, approvalStatus: "Published" }, orderBy: { createdAt: "desc" }, select: _SERVER_SELECT });
	}

	async listAllServers(siloId: string): Promise<readonly McpOperatorServerRecord[]>
	{
		return this._transaction.mcpServer.findMany({ where: { siloId }, orderBy: { createdAt: "desc" }, select: _SERVER_SELECT });
	}

	async findServer(siloId: string, serverId: string): Promise<McpOperatorServerRecord | null>
	{
		return this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId }, select: _SERVER_SELECT });
	}

	async listInstalls(principalId: string): Promise<readonly McpOperatorInstallRecord[]>
	{
		return this._transaction.mcpServerInstall.findMany({ where: { userId: principalId }, orderBy: { createdAt: "asc" }, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true, connectedAccount: true } });
	}

	async upsertInstall(serverId: string, principalId: string, connectionStatus: string): Promise<McpOperatorInstallRecord>
	{
		return this._transaction.mcpServerInstall.upsert({ where: { mcpServerId_userId: { mcpServerId: serverId, userId: principalId } }, create: { mcpServerId: serverId, userId: principalId, connectionStatus: connectionStatus as Prisma.McpServerInstallCreateInput["connectionStatus"] }, update: {}, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true, connectedAccount: true } });
	}

	async deleteInstall(serverId: string, principalId: string): Promise<boolean>
	{
		const result = await this._transaction.mcpServerInstall.deleteMany({ where: { mcpServerId: serverId, userId: principalId } });
		return result.count > 0;
	}

	async findInstall(serverId: string, principalId: string): Promise<McpOperatorInstallRecord | null>
	{
		return this._transaction.mcpServerInstall.findUnique({ where: { mcpServerId_userId: { mcpServerId: serverId, userId: principalId } }, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true, connectedAccount: true } });
	}

	async updateInstall(serverId: string, principalId: string, connectionStatus: string, credentialRef: string | null): Promise<McpOperatorInstallRecord>
	{
		return this._transaction.mcpServerInstall.update({ where: { mcpServerId_userId: { mcpServerId: serverId, userId: principalId } }, data: { connectionStatus: connectionStatus as Prisma.McpServerInstallUpdateInput["connectionStatus"], credentialRef }, select: { mcpServerId: true, connectionStatus: true, lastUsedAt: true, connectedAccount: true } });
	}

	async setApprovalStatus(siloId: string, serverId: string, approvalStatus: string): Promise<McpOperatorServerRecord | null>
	{
		const exists = await this._transaction.mcpServer.findFirst({ where: { id: serverId, siloId }, select: { id: true } });
		if (!exists) return null;
		return this._transaction.mcpServer.update({ where: { id: serverId }, data: { approvalStatus: approvalStatus as Prisma.McpServerUpdateInput["approvalStatus"] }, select: _SERVER_SELECT });
	}

	async listGroups(siloId: string, groupIds?: readonly string[])
	{
		return this._transaction.group.findMany({ where: { siloId, ...(groupIds ? { id: { in: [...groupIds] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
	}

	async listPrincipals(siloId: string, principalIds?: readonly string[]): Promise<readonly McpOperatorPrincipalRecord[]>
	{
		return this._transaction.principal.findMany({ where: { siloId, ...(principalIds ? { id: { in: [...principalIds] } } : {}) }, select: { id: true, email: true, displayName: true }, orderBy: { id: "asc" } });
	}

	async appendAudit(action: string, resource: string, message: string): Promise<void>
	{
		await this._transaction.auditEntry.create({ data: { action, resource, message } });
	}
}
