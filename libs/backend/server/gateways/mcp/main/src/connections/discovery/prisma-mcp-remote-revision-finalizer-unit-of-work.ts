import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { McpRemoteRevisionFinalizationCommand, McpRemoteRevisionFinalizationResult, McpRemoteRevisionFinalizer } from "./mcp-authenticated-connection-discovery.types";
import { PrismaMcpRemoteRevisionFinalizationRepository } from "./prisma-mcp-remote-revision-finalizer";

/** Opens the serializable transaction that selects one remote discovery winner. */
export class PrismaMcpRemoteRevisionFinalizerUnitOfWork implements McpRemoteRevisionFinalizer
{
	/** Root client used only by the shared transaction runner. */
	private readonly _prisma: PrismaClient;

	/** Bind the application Prisma client without exposing it to domain code. */
	constructor(prisma: PrismaClient) { this._prisma = prisma; }

	/** @inheritdoc */
	finalize(command: McpRemoteRevisionFinalizationCommand): Promise<McpRemoteRevisionFinalizationResult>
	{
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Finalize(transaction)
		{
			const authorization = new PrismaAuthorizationAuthority(transaction);
			const grants = new PrismaManagedAuthorizationGrantRepository(transaction);
			const repository = new PrismaMcpRemoteRevisionFinalizationRepository(transaction, authorization, grants);
			return repository.finalize(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "MCP remote revision finalization" });
	}
}
