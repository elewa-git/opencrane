import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import type { ManagedAuthorizationGrantSpec } from "../grants/managed-authorization-grants.types";
import { __ReconcileManagedAuthorizationGrantsInTransaction } from "../grants/persistence/prisma-managed-authorization-grant-repository";

/** Stable manager for requester-owned standing approval metadata rights. */
export const TOOL_APPROVAL_SCOPE_GRANT_MANAGER_ID = "tool-approval-scope-owner";

/** Reconcile exact Personal-bound metadata rights without granting tool execution capability. */
export async function __ReconcileToolApprovalScopeGrants(transaction: Parameters<typeof __ReconcileManagedAuthorizationGrantsInTransaction>[0], siloId: string, scopeId: string, principalId: string, active: boolean, now: Date): Promise<void>
{
	const resource = { kind: ProductAuthorizationResourceKinds.ToolApprovalScope, id: scopeId } as const;
	const actions = active ? [ProductAuthorizationActions.Read, ProductAuthorizationActions.Revoke] as const : [ProductAuthorizationActions.Read] as const;
	const grants = actions.map(function _Grant(action): ManagedAuthorizationGrantSpec
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error(`missing ToolApprovalScope/${action} product capability`);
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId };
	});
	await __ReconcileManagedAuthorizationGrantsInTransaction(transaction, { siloId, managerId: TOOL_APPROVAL_SCOPE_GRANT_MANAGER_ID, resource, grants, now });
}
