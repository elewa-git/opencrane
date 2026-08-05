import type { Prisma } from "@prisma/client";

import type { CreateMcpServerWrite, McpServerCredentialWrite, McpServerMutationRepository, McpServerMutationWriteResult, UpdateMcpServerWrite } from "./mcp-server-mutation-repository.types.js";

/** Transaction-scoped repository for MCP server, credential metadata, and audit rows. */
export class PrismaMcpServerMutationRepository implements McpServerMutationRepository
{
	/** Exact transaction that owns every aggregate write. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Binds the repository to the transaction opened by its unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Creates the server, credential metadata, and audit record. */
	async createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>
	{
		const server = await this._transaction.mcpServer.create({
			data: {
				name: input.name,
				description: input.description,
				endpoint: input.endpoint,
				scope: input.scope as Prisma.McpServerCreateInput["scope"],
				transport: input.transport as Prisma.McpServerCreateInput["transport"],
				status: input.status as Prisma.McpServerCreateInput["status"],
				capabilities: [...input.capabilities],
				...(input.sourceId ? { sourceId: input.sourceId } : {}),
				...(input.lastSyncedAt ? { lastSyncedAt: input.lastSyncedAt } : {}),
			},
		});
		await this._replaceCredentials(server.id, input.credentials);
		await this._transaction.auditEntry.create({ data: { action: "Created", resource: `McpServer/${server.id}`, message: `MCP server ${server.name} created` } });
		return { id: server.id };
	}

	/** Updates the server, replaces credential metadata, and writes the audit record. */
	async updateServer(input: UpdateMcpServerWrite): Promise<void>
	{
		await this._transaction.mcpServer.update({
			where: { id: input.id },
			data: {
				...(input.name ? { name: input.name } : {}),
				...(input.description !== undefined ? { description: input.description } : {}),
				...(input.endpoint ? { endpoint: input.endpoint } : {}),
				...(input.scope ? { scope: input.scope as Prisma.McpServerUpdateInput["scope"] } : {}),
				...(input.transport ? { transport: input.transport as Prisma.McpServerUpdateInput["transport"] } : {}),
				...(input.status ? { status: input.status as Prisma.McpServerUpdateInput["status"] } : {}),
				...(input.capabilities ? { capabilities: [...input.capabilities] } : {}),
				...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
				...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
			},
		});
		await this._replaceCredentials(input.id, input.credentials);
		await this._transaction.auditEntry.create({ data: { action: "Updated", resource: `McpServer/${input.id}`, message: `MCP server ${input.id} updated` } });
	}

	/** Deletes credential metadata and the server before recording the audit entry. */
	async deleteServer(serverId: string): Promise<void>
	{
		await this._transaction.mcpServerCredential.deleteMany({ where: { mcpServerId: serverId } });
		await this._transaction.mcpServer.delete({ where: { id: serverId } });
		await this._transaction.auditEntry.create({ data: { action: "Deleted", resource: `McpServer/${serverId}`, message: `MCP server ${serverId} deleted` } });
	}

	/** Replaces credential children through the transaction that owns their parent. */
	private async _replaceCredentials(serverId: string, credentials: readonly McpServerCredentialWrite[]): Promise<void>
	{
		await this._transaction.mcpServerCredential.deleteMany({ where: { mcpServerId: serverId } });
		if (credentials.length === 0) return;
		await this._transaction.mcpServerCredential.createMany({
			data: credentials.map(function _ToRow(credential)
			{
				return { mcpServerId: serverId, displayName: credential.displayName };
			}),
		});
	}
}
