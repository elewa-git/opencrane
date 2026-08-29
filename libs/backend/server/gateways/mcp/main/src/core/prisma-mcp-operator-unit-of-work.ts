import type { PrismaClient } from "@prisma/client";

import { PrismaAuthorizationGrantRepository, PrismaCapabilityCatalogRepository, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "./mcp-operator-repository.types";
import { PrismaOciImageValidationRepository } from "../oci-image-validation/prisma-oci-image-validation-repository";
import { PrismaMcpOperatorRepository } from "./prisma-mcp-operator-repository";

/** Root Prisma transaction owner for every MCP operator operation. */
export class PrismaMcpOperatorUnitOfWork implements McpOperatorUnitOfWork
{
	private readonly _prisma: PrismaClient;

	constructor(prisma: PrismaClient) { this._prisma = prisma; }

	execute<Result>(operation: (transaction: McpOperatorTransaction) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async function _Execute(transaction)
		{
			return await operation({
				mcp: new PrismaMcpOperatorRepository(transaction),
				ociImageValidations: new PrismaOciImageValidationRepository(transaction),
				authorization: new PrismaAuthorizationGrantRepository(transaction),
				capabilityCatalog: new PrismaCapabilityCatalogRepository(transaction),
				managedGrants: new PrismaManagedAuthorizationGrantRepository(transaction),
				workflowTransaction: { client: transaction },
			});
		});
	}
}
