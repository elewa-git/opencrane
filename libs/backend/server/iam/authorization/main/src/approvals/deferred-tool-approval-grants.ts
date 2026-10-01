import { Prisma } from "@prisma/client";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import type { ManagedAuthorizationGrantSpec } from "../grants/managed-authorization-grants.types";
import { __ReconcileManagedAuthorizationGrantsInTransaction } from "../grants/persistence/prisma-managed-authorization-grant-repository";

/** Stable manager that owns the assigned reviewer's exact approval grants. */
export const DEFERRED_TOOL_APPROVAL_GRANT_MANAGER_ID = "deferred-tool-approval-assignee";

/**
 * Reconciles the manager-owned Read and Decide grants for one pending approval.
 *
 * Called by: deferred approval create, decision, expiry, and run cancellation paths that share the
 * approval transaction. Passing null soft-revokes this manager's grants at terminalization.
 */
export async function __ReconcileDeferredToolApprovalGrants(transaction: Prisma.TransactionClient, siloId: string, approvalRequestId: string, principalId: string | null, now: Date): Promise<void>
{
	const resource = { kind: ProductAuthorizationResourceKinds.ApprovalRequest, id: approvalRequestId } as const;
	const grants: readonly ManagedAuthorizationGrantSpec[] = principalId === null ? [] : [ProductAuthorizationActions.Read, ProductAuthorizationActions.Decide].map(function _Grant(action): ManagedAuthorizationGrantSpec
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error(`missing ApprovalRequest/${action} product capability`);
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId };
	});
	await __ReconcileManagedAuthorizationGrantsInTransaction(transaction, { siloId, managerId: DEFERRED_TOOL_APPROVAL_GRANT_MANAGER_ID, resource, grants, now });
}
