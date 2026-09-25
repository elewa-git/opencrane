import { Prisma, PrismaClient } from "@prisma/client";

import { PrismaManagedAuthorizationGrantRepository, type ReconcileManagedAuthorizationGrantsCommand } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import type { HostedGeneratedFileInstalledTool, HostedGeneratedFilePrerequisites } from "./hosted-generated-file.types";

/** Build the sole direct fixture grant command from exact saved coordinates. */
export function __HostedGeneratedFileAssignCommand(prerequisites: HostedGeneratedFilePrerequisites, installed: HostedGeneratedFileInstalledTool, now: Date): ReconcileManagedAuthorizationGrantsCommand
{
	if (installed.state !== "discovered-published-installed" || installed.toolRevisionId.length === 0)
		throw new Error("Hosted Assign grant requires completed public discovery, publication, and install");
	const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: installed.toolRevisionId };
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.McpToolRevision, ProductAuthorizationActions.Assign);
	if (capability === null)
		throw new Error("Hosted qualification catalogue omitted McpToolRevision Assign");
	return {
		siloId: prerequisites.expectedSiloId,
		managerId: `hosted-generated-file-prerequisite:${prerequisites.expectedPrincipalId}`,
		resource,
		grants: [{ subject: { kind: AuthorizationSubjectKinds.Principal, principalId: prerequisites.expectedPrincipalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: prerequisites.expectedPrincipalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: prerequisites.expectedPrincipalId }],
		now,
	};
}

/** Reconcile the exact Assign prerequisite in one serializable transaction. */
export async function __GrantHostedGeneratedFileAssign(databaseUrl: string, prerequisites: HostedGeneratedFilePrerequisites, installed: HostedGeneratedFileInstalledTool): Promise<void>
{
	const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
	try
	{
		const command = __HostedGeneratedFileAssignCommand(prerequisites, installed, new Date());
		await ___RunInPrismaUnitOfWork(prisma, async function _Grant(transaction)
		{
			await new PrismaManagedAuthorizationGrantRepository(transaction).reconcileManagedResourceGrants(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, attemptLimit: 3, operation: "hosted-generated-file-assign-prerequisite" });
	}
	finally
	{
		await prisma.$disconnect();
	}
}
