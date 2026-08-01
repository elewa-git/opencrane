import { type Prisma, type PrismaClient } from "@prisma/client";

import type { CreateMcpServerWrite, McpServerCredentialWrite, McpServerMutationRepository, McpServerMutationUnitOfWork, McpServerMutationWriteResult, UpdateMcpServerWrite } from "./mcp-server-mutation-repository.types.js";

/** Prisma adapter that owns one MCP server aggregate, its credential metadata, and its audit trail. */
export class PrismaMcpServerMutationRepository implements McpServerMutationRepository, McpServerMutationUnitOfWork
{
	/** Canonical product-authority client for MCP server credential rows. */
	private readonly _prisma: PrismaClient;

	/** Constructs the repository around the application-composed authority client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Creates a server, its credential metadata, and its audit entry in one database transaction. */
	async createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>
	{
		return this._prisma.$transaction(async (transaction) =>
		{
			const server = await transaction.mcpServer.create({
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
			await this._replaceCredentials(transaction, server.id, input.credentials);
			await transaction.auditEntry.create({ data: { action: "Created", resource: `McpServer/${server.id}`, message: `MCP server ${server.name} created` } });
			return { id: server.id };
		});
	}

	/** Updates a server, replaces its credential metadata, and writes its audit entry in one database transaction. */
	async updateServer(input: UpdateMcpServerWrite): Promise<void>
	{
		await this._prisma.$transaction(async (transaction): Promise<void> =>
		{
			await transaction.mcpServer.update({
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
			await this._replaceCredentials(transaction, input.id, input.credentials);
			await transaction.auditEntry.create({ data: { action: "Updated", resource: `McpServer/${input.id}`, message: `MCP server ${input.id} updated` } });
		});
	}

	/** Deletes a server, its credential metadata, and its audit entry in one database transaction. */
	async deleteServer(serverId: string): Promise<void>
	{
		await this._prisma.$transaction(async (transaction): Promise<void> =>
		{
			await transaction.mcpServerCredential.deleteMany({ where: { mcpServerId: serverId } });
			await transaction.mcpServer.delete({ where: { id: serverId } });
			await transaction.auditEntry.create({ data: { action: "Deleted", resource: `McpServer/${serverId}`, message: `MCP server ${serverId} deleted` } });
		});
	}

	/** Replaces credential children through the transaction that owns their MCP server aggregate. */
	private async _replaceCredentials(transaction: Prisma.TransactionClient, serverId: string, credentials: readonly McpServerCredentialWrite[]): Promise<void>
	{
		await transaction.mcpServerCredential.deleteMany({ where: { mcpServerId: serverId } });
		if (credentials.length === 0) return;
		await transaction.mcpServerCredential.createMany({
			data: credentials.map(function _toRow(credential)
			{
				return { mcpServerId: serverId, displayName: credential.displayName };
			}),
		});
	}
}
