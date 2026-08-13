import type { PrismaClient } from "@prisma/client";

import type { CreateMcpServerWrite, McpServerMutationRepository, McpServerMutationUnitOfWork, McpServerMutationWriteResult, UpdateMcpServerWrite } from "./mcp-server-mutation-repository.types.js";
import { PrismaMcpServerMutationRepository } from "./prisma-mcp-server-mutation-repository.js";

/**
 * Opens one Prisma transaction per call and runs the server write, its credential rows, and the
 * audit row inside it, so all of them land or none of them do.
 *
 * This is what a route should use: it needs no ambient transaction, and it guarantees the
 * catalogue can never show a server whose credential rows or audit entry are missing. Code that
 * already holds a transaction should use `PrismaMcpServerMutationRepository` instead, so the two
 * do not nest.
 *
 * Called by: `mcpServersRouter` in ../routes/mcp-servers.ts, which builds one instance and passes
 * it to `createMcpServer`, `updateMcpServer` and `deleteMcpServer`.
 *
 * @see https://www.prisma.io/docs/orm/prisma-client/queries/transactions — the interactive
 *      `$transaction` callback form used by `_withRepository`.
 */
export class PrismaMcpServerMutationUnitOfWork implements McpServerMutationUnitOfWork
{
	/** Canonical product-authority client that opens the transaction. */
	private readonly _prisma: PrismaClient;

	/** Constructs the unit of work around the application-composed authority client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Create the server, its credential rows, and the audit row in one transaction. @returns The new server's id. */
	async createServer(input: CreateMcpServerWrite): Promise<McpServerMutationWriteResult>
	{
		return this._withRepository(async function _Create(repository)
		{
			return repository.createServer(input);
		});
	}

	/** Change the server, replace its credential rows, and add the audit row in one transaction. */
	async updateServer(input: UpdateMcpServerWrite): Promise<void>
	{
		await this._withRepository(async function _Update(repository): Promise<void>
		{
			await repository.updateServer(input);
		});
	}

	/** Delete the credential rows, the server row, and add the audit row in one transaction. */
	async deleteServer(serverId: string): Promise<void>
	{
		await this._withRepository(async function _Delete(repository): Promise<void>
		{
			await repository.deleteServer(serverId);
		});
	}

	/** Open one Prisma transaction, hand its client to a fresh `PrismaMcpServerMutationRepository`, and run the caller's writes on it. */
	private async _withRepository<Result>(operation: (repository: McpServerMutationRepository) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async function _Run(transaction)
		{
			return operation(new PrismaMcpServerMutationRepository(transaction));
		});
	}
}
