import { OrgMemberStatus, OrgRole, type Prisma } from "@prisma/client";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import type { OrganizationAdminGrantBootstrapRepository, ReconcileOrganizationAdminGrantCommand } from "./organization-admin-grant-bootstrap.types";
import { PrismaManagedAuthorizationGrantRepository } from "./prisma-managed-authorization-grant-repository";

/** Prefixes grants maintained from one Principal's current organisation membership role. */
const _ORGANIZATION_ADMIN_GRANT_MANAGER_ID = "organization-membership-admin-bootstrap";

/** Reports whether the stored membership currently delegates organisation administration. */
function _MayAdministerOrganization(membership: { readonly role: OrgRole; readonly status: OrgMemberStatus } | null): boolean
{
	if (membership === null || membership.status !== OrgMemberStatus.Active)
	{
		return false;
	}
	return membership.role === OrgRole.Owner || membership.role === OrgRole.Admin;
}

/**
 * Reconciles the membership-owned organisation administration grant inside the caller's transaction.
 *
 * The adapter converts an active Owner or Admin role into one ordinary managed grant. A missing,
 * suspended, or Member membership produces an empty desired set, which revokes this manager's prior
 * read and administration grants without touching grants written by another authority.
 *
 * Called by: `PrismaAuthenticatedPrincipalAdmissionUnitOfWork` during authenticated request admission.
 * @implements OrganizationAdminGrantBootstrapRepository
 */
export class PrismaOrganizationAdminGrantBootstrapRepository implements OrganizationAdminGrantBootstrapRepository
{
	/** Prisma client bound to the authenticated-admission database transaction. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds membership lookup and managed-grant reconciliation to the caller's transaction.
	 * @param transaction - Prisma transaction opened by authenticated Principal admission.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async reconcileOrganizationAdminGrant(command: ReconcileOrganizationAdminGrantCommand): Promise<number>
	{
		// 1. Reject incomplete coordinates so a bootstrap bug cannot write a broad or orphaned grant.
		if (!command.siloId.trim() || !command.subject.trim() || !command.principalId.trim() || !Number.isFinite(command.now.getTime()))
		{
			throw new Error("organization administrator grant coordinates are invalid");
		}

		// 2. Read the membership linked to the verified subject so a role or status change is effective now.
		const membership = await this.transaction.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: command.siloId, subject: command.subject } }, select: { role: true, status: true } });

		// 3. Reconcile this bootstrap manager's desired grant through the shared grant writer.
		const resource = { kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId } as const;
		const capabilities = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Administer].map(function _Capability(action)
		{
			const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Organization, action);
			if (capability === null)
			{
				throw new Error(`organization ${action} capability is missing from the product catalogue`);
			}
			return capability;
		});
		const grants = _MayAdministerOrganization(membership)
			? capabilities.map(function _Grant(capability) { return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: command.principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: command.principalId } as const; })
			: [];
		const repository = new PrismaManagedAuthorizationGrantRepository(this.transaction);
		const managerId = `${_ORGANIZATION_ADMIN_GRANT_MANAGER_ID}:${command.principalId}`;
		return repository.reconcileManagedResourceGrants({ siloId: command.siloId, managerId, resource, grants, now: command.now });
	}
}
