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

/** Returns the persisted row shape consumed by the shared managed-grant repository. */
function _ExistingOrganizationAdminGrant()
{
	return {
		id: "grant-old",
		subjectKind: "Principal",
		subjectGroupId: null,
		subjectPrincipalId: "principal-1",
		boundaryKind: "Personal",
		boundaryGroupId: null,
		boundaryPrincipalId: "principal-1",
		boundaryCoverage: "Exact",
		catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID,
		catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION,
		catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST,
		capabilityId: "organization:administer",
		resourceKind: "organization",
		resourceId: "silo-a",
		priority: 0,
		createdBy: "principal-1",
	};
}

describe("PrismaOrganizationAdminGrantBootstrapRepository", function _Suite()
{
	it.each([OrgRole.Owner, OrgRole.Admin])("creates managed read and administration grants for an active %s", async function _Creates(role)
	{
		const store = _Transaction({ role, status: OrgMemberStatus.Active });
		const repository = new PrismaOrganizationAdminGrantBootstrapRepository(store.transaction);

		await expect(repository.reconcileOrganizationAdminGrant({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now: new Date("2026-08-29T00:00:00.000Z") })).resolves.toBe(2);
		expect(store.grantFindMany).toHaveBeenCalledWith({ where: { siloId: "silo-a", managerId: "organization-membership-admin-bootstrap", resourceKind: "organization", resourceId: "silo-a", effect: "Allow", revokedAt: null }, select: expect.any(Object) });
		expect(store.grantCreate).toHaveBeenCalledTimes(2);
		expect(store.grantCreate.mock.calls.map(call => call[0].data.capabilityId)).toEqual(["organization:read", "organization:administer"]);
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ managerId: "organization-membership-admin-bootstrap", subjectPrincipalId: "principal-1", boundaryPrincipalId: "principal-1", catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID, catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION, catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST, resourceKind: "organization", resourceId: "silo-a" }) });
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
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-old"] }, siloId: "silo-a", managerId: "organization-membership-admin-bootstrap", revokedAt: null }, data: { revokedAt: now } });
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
});
