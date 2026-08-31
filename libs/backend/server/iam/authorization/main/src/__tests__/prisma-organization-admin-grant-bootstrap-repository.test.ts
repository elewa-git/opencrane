import { OrgMemberStatus, OrgRole, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID, PRODUCT_AUTHORIZATION_CATALOG_REVISION } from "@opencrane/models/authorization";

import { PrismaOrganizationAdminGrantBootstrapRepository } from "../prisma-organization-admin-grant-bootstrap-repository";

/** Builds the transaction delegates used by organisation-administrator grant bootstrap. */
function _Transaction(membership: { readonly role: OrgRole; readonly status: OrgMemberStatus } | null, currentGrants: readonly Record<string, unknown>[] = [])
{
	const membershipFindUnique = vi.fn().mockResolvedValue(membership);
	const grantFindMany = vi.fn().mockResolvedValue(currentGrants);
	const grantCreate = vi.fn().mockResolvedValue({ id: "grant-new" });
	const grantUpdateMany = vi.fn().mockResolvedValue({ count: currentGrants.length });
	const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
	const transaction = {
		orgMembership: { findUnique: membershipFindUnique },
		authorizationGrant: { findMany: grantFindMany, create: grantCreate, updateMany: grantUpdateMany },
		auditEntry: { create: auditCreate },
	} as unknown as Prisma.TransactionClient;
	return { transaction, membershipFindUnique, grantFindMany, grantCreate, grantUpdateMany, auditCreate };
}

/** Returns one persisted organisation grant consumed by the shared managed-grant repository. */
function _ExistingOrganizationAdminGrant(id = "grant-old", principalId = "principal-1", capabilityId = "organization:administer")
{
	return {
		id,
		subjectKind: "Principal",
		subjectGroupId: null,
		subjectPrincipalId: principalId,
		boundaryKind: "Personal",
		boundaryGroupId: null,
		boundaryPrincipalId: principalId,
		boundaryCoverage: "Exact",
		catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID,
		catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION,
		catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST,
		capabilityId,
		resourceKind: "organization",
		resourceId: "silo-a",
		priority: 0,
		createdBy: principalId,
	};
}

describe("PrismaOrganizationAdminGrantBootstrapRepository", function _Suite()
{
	it.each([OrgRole.Owner, OrgRole.Admin])("creates managed read and administration grants for an active %s", async function _Creates(role)
	{
		const store = _Transaction({ role, status: OrgMemberStatus.Active });
		const repository = new PrismaOrganizationAdminGrantBootstrapRepository(store.transaction);

		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now: new Date("2026-08-29T00:00:00.000Z") })).resolves.toBe(2);
		expect(store.grantFindMany).toHaveBeenCalledWith({ where: { siloId: "silo-a", managerId: "organization-membership-admin-bootstrap:principal-1", resourceKind: "organization", resourceId: "silo-a", effect: "Allow", revokedAt: null }, select: expect.any(Object) });
		expect(store.grantCreate).toHaveBeenCalledTimes(2);
		expect(store.grantCreate.mock.calls.map(call => call[0].data.capabilityId)).toEqual(["organization:read", "organization:administer"]);
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ managerId: "organization-membership-admin-bootstrap:principal-1", subjectPrincipalId: "principal-1", boundaryPrincipalId: "principal-1", catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID, catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION, catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST, resourceKind: "organization", resourceId: "silo-a" }) });
	});

	it.each([
		{ role: OrgRole.Member, status: OrgMemberStatus.Active },
		{ role: OrgRole.Admin, status: OrgMemberStatus.Suspended },
	])("revokes this bootstrap manager's grant for membership $role/$status", async function _Revokes(membership)
	{
		const store = _Transaction(membership, [_ExistingOrganizationAdminGrant()]);
		const repository = new PrismaOrganizationAdminGrantBootstrapRepository(store.transaction);
		const now = new Date("2026-08-29T00:00:00.000Z");

		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now })).resolves.toBe(1);
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-old"] }, siloId: "silo-a", managerId: "organization-membership-admin-bootstrap:principal-1", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantCreate).not.toHaveBeenCalled();
	});

	it("treats a missing membership as revocation instead of retaining role-derived permission", async function _MissingMembership()
	{
		const store = _Transaction(null, [_ExistingOrganizationAdminGrant()]);
		const repository = new PrismaOrganizationAdminGrantBootstrapRepository(store.transaction);

		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now: new Date("2026-08-29T00:00:00.000Z") })).resolves.toBe(1);
		expect(store.grantUpdateMany).toHaveBeenCalledOnce();
		expect(store.grantCreate).not.toHaveBeenCalled();
	});

	it("suspends one administrator without revoking another Principal's grants on the same organisation", async function _IsolatesAdministrators()
	{
		// 1. Store complete grant sets for two administrators so the test can expose cross-Principal reconciliation.
		const now = new Date("2026-08-29T00:00:00.000Z");
		const grantsByManager = new Map([
			["organization-membership-admin-bootstrap:principal-1", [_ExistingOrganizationAdminGrant("grant-principal-1-read", "principal-1", "organization:read"), _ExistingOrganizationAdminGrant("grant-principal-1-administer", "principal-1")]],
			["organization-membership-admin-bootstrap:principal-2", [_ExistingOrganizationAdminGrant("grant-principal-2-read", "principal-2", "organization:read"), _ExistingOrganizationAdminGrant("grant-principal-2-administer", "principal-2")]],
		]);
		const membershipFindUnique = vi.fn().mockImplementation(async function _FindMembership({ where }: { readonly where: { readonly clusterTenant_subject: { readonly subject: string } } })
		{
			return { role: OrgRole.Admin, status: where.clusterTenant_subject.subject === "subject-1" ? OrgMemberStatus.Active : OrgMemberStatus.Suspended };
		});
		const grantFindMany = vi.fn().mockImplementation(async function _FindGrants({ where }: { readonly where: { readonly managerId: string } })
		{
			return grantsByManager.get(where.managerId) ?? [];
		});
		const grantCreate = vi.fn().mockResolvedValue({ id: "grant-new" });
		const grantUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
		const transaction = { orgMembership: { findUnique: membershipFindUnique }, authorizationGrant: { findMany: grantFindMany, create: grantCreate, updateMany: grantUpdateMany }, auditEntry: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaOrganizationAdminGrantBootstrapRepository(transaction);

		// 2. Reconcile the active administrator before suspending the second one on the same resource.
		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now })).resolves.toBe(0);
		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-2", principalId: "principal-2", now })).resolves.toBe(2);

		// 3. Revoke only the suspended Principal's rows so the active administrator keeps both grants.
		expect(grantCreate).not.toHaveBeenCalled();
		expect(grantUpdateMany).toHaveBeenCalledOnce();
		expect(grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-principal-2-read", "grant-principal-2-administer"] }, siloId: "silo-a", managerId: "organization-membership-admin-bootstrap:principal-2", revokedAt: null }, data: { revokedAt: now } });
	});
});
