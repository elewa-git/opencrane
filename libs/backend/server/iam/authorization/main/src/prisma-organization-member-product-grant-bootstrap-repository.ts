import { OrgMemberStatus, type Prisma } from "@prisma/client";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import type { ManagedAuthorizationGrantSpec } from "./managed-authorization-grants.types";
import type { OrganizationMemberProductGrantBootstrapRepository, ReconcileOrganizationMemberProductGrantsCommand } from "./organization-member-product-grant-bootstrap.types";
import { PrismaManagedAuthorizationGrantRepository } from "./prisma-managed-authorization-grant-repository";

/** Prefixes collection-root grants derived from one Principal's active organisation membership. */
export const ORGANIZATION_MEMBER_PRODUCT_GRANT_MANAGER_ID = "organization-membership-product-bootstrap";

/** Reconciles narrow creation-root grants without treating an organisation role as runtime policy. */
export class PrismaOrganizationMemberProductGrantBootstrapRepository implements OrganizationMemberProductGrantBootstrapRepository
{
	private readonly transaction: Prisma.TransactionClient;

	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async reconcileOrganizationMemberProductGrants(command: ReconcileOrganizationMemberProductGrantsCommand): Promise<number>
	{
		if (!command.siloId.trim() || !command.subject.trim() || !command.principalId.trim() || !Number.isFinite(command.now.getTime()))
		{
			throw new Error("organization member product grant coordinates are invalid");
		}
		const membership = await this.transaction.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: command.siloId, subject: command.subject } }, select: { status: true } });
		const active = membership?.status === OrgMemberStatus.Active;
		const repository = new PrismaManagedAuthorizationGrantRepository(this.transaction);
		const managerId = `${ORGANIZATION_MEMBER_PRODUCT_GRANT_MANAGER_ID}:${command.principalId}`;
		let changedCount = 0;
		for (const kind of [ProductAuthorizationResourceKinds.AgentServiceCollection, ProductAuthorizationResourceKinds.ConversationCollection, ProductAuthorizationResourceKinds.ArtifactCollection, ProductAuthorizationResourceKinds.PersonaCollection] as const)
		{
			const resource = { kind, id: command.siloId } as const;
			const capability = __ProductAuthorizationCapability(kind, ProductAuthorizationActions.Create);
			if (capability === null)
				throw new Error(`${kind} creation capability is missing from the product catalogue`);
			const grants: readonly ManagedAuthorizationGrantSpec[] = active ? [{
				subject: { kind: AuthorizationSubjectKinds.Principal, principalId: command.principalId },
				boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: command.principalId },
				boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
				capability,
				resource,
				priority: 0,
				createdByPrincipalId: command.principalId,
			}] : [];
			changedCount += await repository.reconcileManagedResourceGrants({ siloId: command.siloId, managerId, resource, grants, now: command.now });
		}
		return changedCount;
	}
}
