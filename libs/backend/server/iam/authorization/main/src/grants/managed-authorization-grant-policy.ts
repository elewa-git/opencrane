import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds } from "@opencrane/models/authorization";

import type { ManagedAuthorizationGrantPlan, ManagedAuthorizationGrantSpec, ReconcileManagedAuthorizationGrantsCommand } from "./managed-authorization-grants.types";

/** Builds the stable identity of one editor-owned grant. */
export function __ManagedAuthorizationGrantKey(grant: ManagedAuthorizationGrantSpec): string
{
	const subject = grant.subject.kind === AuthorizationSubjectKinds.Group ? `group:${grant.subject.groupId}` : `principal:${grant.subject.principalId}`;
	const boundary = grant.boundary.kind === AuthorizationBoundaryKinds.Group ? `group:${grant.boundary.groupId}` : `personal:${grant.boundary.principalId}`;
	return [subject, boundary, grant.boundaryCoverage, grant.capability.catalog.catalogId, grant.capability.catalog.revision, grant.capability.catalog.digest, grant.capability.capabilityId, grant.resource.kind, grant.resource.id, grant.priority].join("\u0000");
}

/** Validates one complete replacement and removes duplicate desired grants. */
export function __PlanManagedAuthorizationGrantReconciliation(command: ReconcileManagedAuthorizationGrantsCommand): ManagedAuthorizationGrantPlan
{
	if (!command.siloId.trim() || !command.managerId.trim() || !command.resource.kind.trim() || !command.resource.id.trim() || !Number.isFinite(command.now.getTime()))
	{
		throw new Error("managed authorization reconciliation coordinates are invalid");
	}

	const desiredByKey = new Map<string, ManagedAuthorizationGrantSpec>();
	for (const grant of command.grants)
	{
		if (grant.resource.kind !== command.resource.kind || grant.resource.id !== command.resource.id)
		{
			throw new Error("managed authorization grant resource does not match reconciliation resource");
		}
		if (grant.boundary.kind === AuthorizationBoundaryKinds.Personal && grant.boundaryCoverage !== AuthorizationBoundaryCoverages.Exact)
		{
			throw new Error("personal authorization boundaries require exact coverage");
		}
		desiredByKey.set(__ManagedAuthorizationGrantKey(grant), grant);
	}
	return { desiredByKey };
}
