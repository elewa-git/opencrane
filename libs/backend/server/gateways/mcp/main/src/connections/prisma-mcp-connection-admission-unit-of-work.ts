import type { Prisma, PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { McpConnectionAdmissionUnitOfWork, McpConnectionTransaction, McpConnectionWorkflowAdmission } from "./mcp-connection.types";
import type { PrismaMcpConnectionManagedServiceResolverFactory } from "./prisma-mcp-connection-admission-unit-of-work.types";
import { PrismaMcpConnectionRepository } from "./prisma-mcp-connection-repository";
import { PrismaMcpInstallAuditRepository } from "./installs/prisma-mcp-install-audit-repository";
import { PrismaMcpInstallRemovalRepository } from "./installs/prisma-mcp-install-removal-repository";

/** Serializable transaction owner for MCP connection admission and revocation. */
export class PrismaMcpConnectionAdmissionUnitOfWork implements McpConnectionAdmissionUnitOfWork
{
	constructor(private readonly _prisma: PrismaClient, private readonly _workflow: McpConnectionWorkflowAdmission, private readonly _managedServices: PrismaMcpConnectionManagedServiceResolverFactory<Prisma.TransactionClient>) {}

	execute<Result>(operation: (transaction: McpConnectionTransaction) => Promise<Result>): Promise<Result>
	{
		const workflow = this._workflow;
		const managedServices = this._managedServices;
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Execute(transaction): Promise<Result>
		{
			return operation({
				connections: new PrismaMcpConnectionRepository(transaction),
				installRemoval: new PrismaMcpInstallRemovalRepository(transaction),
				installAudit: new PrismaMcpInstallAuditRepository(transaction),
				authorization: new PrismaAuthorizationAuthority(transaction),
				grants: new PrismaManagedAuthorizationGrantRepository(transaction),
				managedServices: managedServices.create(transaction),
				workflow,
				workflowTransaction: { client: transaction },
			});
		}, { isolationLevel: "Serializable", operation: "MCP connection admission", attemptLimit: 3 });
	}
}
