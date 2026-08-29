import { OrgMemberStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID, PRODUCT_AUTHORIZATION_CATALOG_REVISION } from "@opencrane/models/authorization";

import { PrismaOrganizationMemberProductGrantBootstrapRepository } from "../prisma-organization-member-product-grant-bootstrap-repository";

/** Returns one current managed collection grant in the persisted repository shape. */
function _Grant(kind: "agent-service-collection" | "artifact-collection" | "conversation-collection" | "persona-collection")
{
	return { id: `grant-${kind}`, subjectKind: "Principal", subjectGroupId: null, subjectPrincipalId: "principal-1", boundaryKind: "Personal", boundaryGroupId: null, boundaryPrincipalId: "principal-1", boundaryCoverage: "Exact", catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID, catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION, catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST, capabilityId: `${kind}:create`, resourceKind: kind, resourceId: "silo-a", priority: 0, createdBy: "principal-1" };
}

/** Builds the exact transaction used to prove access is revoked before admission can deny. */
function _Transaction(status: OrgMemberStatus | null, hasGrants = true)
{
	const grants = hasGrants ? [_Grant("agent-service-collection"), _Grant("conversation-collection"), _Grant("artifact-collection"), _Grant("persona-collection")] : [];
	const grantFindMany = vi.fn().mockImplementation(async function _Find({ where }: { readonly where: { readonly resourceKind: string } }) { return grants.filter(grant => grant.resourceKind === where.resourceKind); });
	const grantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const grantCreate = vi.fn().mockResolvedValue({ id: "grant-new" });
	const transaction = { orgMembership: { findUnique: vi.fn().mockResolvedValue(status === null ? null : { status }) }, authorizationGrant: { findMany: grantFindMany, create: grantCreate, updateMany: grantUpdateMany }, auditEntry: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) } } as unknown as Prisma.TransactionClient;
	return { transaction, grantCreate, grantUpdateMany };
}

describe("PrismaOrganizationMemberProductGrantBootstrapRepository", function _Suite()
{
	it.each([OrgMemberStatus.Suspended, null])("soft-revokes all collection Create grants before later admission denies status %s", async function _Revokes(status)
	{
		const store = _Transaction(status);
		const now = new Date("2026-08-29T00:00:00.000Z");
		await expect(new PrismaOrganizationMemberProductGrantBootstrapRepository(store.transaction).reconcileOrganizationMemberProductGrants({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now })).resolves.toBe(4);
		expect(store.grantUpdateMany).toHaveBeenCalledTimes(4);
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-agent-service-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-conversation-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-artifact-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-persona-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap", revokedAt: null }, data: { revokedAt: now } });
	});

	it("projects all four collection Create grants for an active ordinary member", async function _ProjectsCollections()
	{
		const store = _Transaction(OrgMemberStatus.Active, false);
		await expect(new PrismaOrganizationMemberProductGrantBootstrapRepository(store.transaction).reconcileOrganizationMemberProductGrants({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now: new Date("2026-08-29T00:00:00.000Z") })).resolves.toBe(4);
		expect(store.grantCreate).toHaveBeenCalledTimes(4);
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ capabilityId: "agent-service-collection:create", resourceKind: "agent-service-collection", resourceId: "silo-a", subjectPrincipalId: "principal-1" }) });
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ capabilityId: "persona-collection:create", resourceKind: "persona-collection", resourceId: "silo-a", subjectPrincipalId: "principal-1" }) });
	});
});
