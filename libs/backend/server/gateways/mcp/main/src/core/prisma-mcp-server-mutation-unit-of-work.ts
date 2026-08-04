import type { PrismaClient } from "@prisma/client";

import type { CreateMcpServerWrite, McpServerMutationRepository, McpServerMutationUnitOfWork, McpServerMutationWriteResult, UpdateMcpServerWrite } from "./mcp-server-mutation-repository.types.js";
import { PrismaMcpServerMutationRepository } from "./prisma-mcp-server-mutation-repository.js";

/** Prisma transaction owner for one MCP server aggregate and its audit trail. */
export class PrismaMcpServerMutationUnitOfWork implements McpServerMutationUnitOfWork
{
	/** Canonical product-authority client that opens the transaction. */
	private readonly _prisma: PrismaClient;

	/** Constructs the unit of work around the application-composed authority client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Creates the complete MCP server aggregate atomically. */
	async createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>
	{
		return this._withRepository(async function _Create(repository)
		{
			return repository.createServer(input);
		});
	}

	/** Updates the complete MCP server aggregate atomically. */
	async updateServer(input: UpdateMcpServerWrite): Promise<void>
	{
		await this._withRepository(async function _Update(repository): Promise<void>
		{
			await repository.updateServer(input);
		});
	}

	/** Deletes the complete MCP server aggregate atomically. */
	async deleteServer(serverId: string): Promise<void>
	{
		await this._withRepository(async function _Delete(repository): Promise<void>
		{
			await repository.deleteServer(serverId);
		});
	}

	/** Opens one transaction and binds its exact client to the aggregate repository. */
	private async _withRepository<Result>(operation: (repository: McpServerMutationRepository) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async function _Run(transaction)
		{
			return operation(new PrismaMcpServerMutationRepository(transaction));
		});
	}
}
