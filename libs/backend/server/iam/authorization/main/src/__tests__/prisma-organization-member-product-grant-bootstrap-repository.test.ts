import { OrgMemberStatus, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID, PRODUCT_AUTHORIZATION_CATALOG_REVISION } from "@opencrane/models/authorization";

import { PrismaOrganizationMemberProductGrantBootstrapRepository } from "../prisma-organization-member-product-grant-bootstrap-repository";

/** Returns one current Principal-owned collection grant in the persisted repository shape. */
function _Grant(kind: "agent-service-collection" | "artifact-collection" | "conversation-collection" | "persona-collection", principalId = "principal-1", id = `grant-${kind}`)
{
	return { id, subjectKind: "Principal", subjectGroupId: null, subjectPrincipalId: principalId, boundaryKind: "Personal", boundaryGroupId: null, boundaryPrincipalId: principalId, boundaryCoverage: "Exact", catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID, catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION, catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST, capabilityId: `${kind}:create`, resourceKind: kind, resourceId: "silo-a", priority: 0, createdBy: principalId };
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
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-agent-service-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap:principal-1", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-conversation-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap:principal-1", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-artifact-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap:principal-1", revokedAt: null }, data: { revokedAt: now } });
		expect(store.grantUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["grant-persona-collection"] }, siloId: "silo-a", managerId: "organization-membership-product-bootstrap:principal-1", revokedAt: null }, data: { revokedAt: now } });
	});

	it("projects all four collection Create grants for an active ordinary member", async function _ProjectsCollections()
	{
		const store = _Transaction(OrgMemberStatus.Active, false);
		await expect(new PrismaOrganizationMemberProductGrantBootstrapRepository(store.transaction).reconcileOrganizationMemberProductGrants({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now: new Date("2026-08-29T00:00:00.000Z") })).resolves.toBe(4);
		expect(store.grantCreate).toHaveBeenCalledTimes(4);
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ capabilityId: "agent-service-collection:create", resourceKind: "agent-service-collection", resourceId: "silo-a", subjectPrincipalId: "principal-1" }) });
		expect(store.grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ capabilityId: "persona-collection:create", resourceKind: "persona-collection", resourceId: "silo-a", subjectPrincipalId: "principal-1" }) });
	});

	it("suspends one member without revoking another Principal's grants on the same collection roots", async function _IsolatesMembers()
	{
		// 1. Store four creation grants per member so every shared collection root exercises manager isolation.
		const now = new Date("2026-08-29T00:00:00.000Z");
		const kinds = ["agent-service-collection", "conversation-collection", "artifact-collection", "persona-collection"] as const;
		const grantsByManager = new Map([
			["organization-membership-product-bootstrap:principal-1", kinds.map(kind => _Grant(kind, "principal-1", `grant-principal-1-${kind}`))],
			["organization-membership-product-bootstrap:principal-2", kinds.map(kind => _Grant(kind, "principal-2", `grant-principal-2-${kind}`))],
		]);
		const membershipFindUnique = vi.fn().mockImplementation(async function _FindMembership({ where }: { readonly where: { readonly clusterTenant_subject: { readonly subject: string } } })
		{
			return { status: where.clusterTenant_subject.subject === "subject-1" ? OrgMemberStatus.Active : OrgMemberStatus.Suspended };
		});
		const grantFindMany = vi.fn().mockImplementation(async function _FindGrants({ where }: { readonly where: { readonly managerId: string; readonly resourceKind: string } })
		{
			return (grantsByManager.get(where.managerId) ?? []).filter(grant => grant.resourceKind === where.resourceKind);
		});
		const grantCreate = vi.fn().mockResolvedValue({ id: "grant-new" });
		const grantUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { orgMembership: { findUnique: membershipFindUnique }, authorizationGrant: { findMany: grantFindMany, create: grantCreate, updateMany: grantUpdateMany }, auditEntry: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaOrganizationMemberProductGrantBootstrapRepository(transaction);

		// 2. Reconcile the active member before suspending the second member across the same roots.
		await expect(repository.reconcileOrganizationMemberProductGrants({ siloId: "silo-a", subject: "subject-1", principalId: "principal-1", now })).resolves.toBe(0);
		await expect(repository.reconcileOrganizationMemberProductGrants({ siloId: "silo-a", subject: "subject-2", principalId: "principal-2", now })).resolves.toBe(4);

		// 3. Revoke only the suspended Principal's rows so the active member keeps every creation grant.
		expect(grantCreate).not.toHaveBeenCalled();
		expect(grantUpdateMany).toHaveBeenCalledTimes(4);
		expect(grantUpdateMany.mock.calls.map(call => call[0].where.managerId)).toEqual(Array(4).fill("organization-membership-product-bootstrap:principal-2"));
		expect(grantUpdateMany.mock.calls.flatMap(call => call[0].where.id.in)).toEqual(kinds.map(kind => `grant-principal-2-${kind}`));
	});
});
