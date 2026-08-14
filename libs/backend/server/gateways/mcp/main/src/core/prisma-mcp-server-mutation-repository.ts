import type { Prisma } from "@prisma/client";

import type { CreateMcpServerWrite, McpServerCredentialWrite, McpServerMutationRepository, McpServerMutationWriteResult, UpdateMcpServerWrite } from "./mcp-server-mutation-repository.types";

/**
 * Writes MCP server rows, their credential label rows, and the audit row — all through a Prisma
 * transaction that someone else opened.
 *
 * It takes a transaction client rather than a `PrismaClient`, so it cannot commit on its own. That
 * is deliberate: {@link PrismaMcpServerMutationUnitOfWork} owns the commit, and this class only
 * describes the writes. Use this directly when you are already inside a transaction; otherwise use
 * the unit of work.
 *
 * Called by: `PrismaMcpServerMutationUnitOfWork._withRepository` in
 * ./prisma-mcp-server-mutation-unit-of-work.ts. No other construction site in this repo.
 */
export class PrismaMcpServerMutationRepository implements McpServerMutationRepository
{
	/** The Prisma transaction all writes in this class run on; it is committed by the caller, not here. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Binds the repository to the transaction opened by its unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Insert the server row, then its credential rows, then the audit row — all on the held transaction. @returns The new server's id. */
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

	/** Patch the supplied server fields, delete and re-insert all credential rows, then add the audit row. */
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

	/** Delete every credential row for this server, then insert the supplied labels. An empty list just deletes. */
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
