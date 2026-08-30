import { OrgMemberStatus, OrgRole, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID, PRODUCT_AUTHORIZATION_CATALOG_REVISION } from "@opencrane/models/authorization";

import { PrismaAuthenticatedPrincipalAdmissionUnitOfWork } from "../prisma-authenticated-principal-admission-unit-of-work";
import { PrismaAuthenticatedPrincipalCapabilityUnitOfWork } from "../prisma-authenticated-principal-capability-unit-of-work";

/** Build the exact transaction delegates used by authenticated Principal admission. */
function _Prisma(resolvedPrincipal: { id: string; siloId: string } | null = { id: "principal-1", siloId: "silo-a" }): {
	readonly prisma: PrismaClient;
	readonly principalFindUnique: ReturnType<typeof vi.fn>;
	readonly membershipFindUnique: ReturnType<typeof vi.fn>;
	readonly grantFindMany: ReturnType<typeof vi.fn>;
	readonly grantCreate: ReturnType<typeof vi.fn>;
	readonly grantUpdateMany: ReturnType<typeof vi.fn>;
}
{
	const principalFindUnique = vi.fn().mockResolvedValue(resolvedPrincipal);
	const membershipFindUnique = vi.fn().mockResolvedValue({ role: OrgRole.Owner, status: OrgMemberStatus.Active });
	const grantFindMany = vi.fn().mockResolvedValue([]);
	const grantCreate = vi.fn().mockResolvedValue({ id: "grant-1" });
	const grantUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
	const transaction = {
		principal: { findUnique: principalFindUnique },
		orgMembership: { findUnique: membershipFindUnique },
		authorizationGrant: { findMany: grantFindMany, create: grantCreate, updateMany: grantUpdateMany },
		auditEntry: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
	};
	const prisma = {
		$transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }),
	} as unknown as PrismaClient;
	return { prisma, principalFindUnique, membershipFindUnique, grantFindMany, grantCreate, grantUpdateMany };
}

describe("PrismaAuthenticatedPrincipalAdmissionUnitOfWork", function _Suite()
{
	it("resolves the issuer-scoped Principal and projects its current administrator grant", async function _Admits()
	{
		const { prisma, principalFindUnique, membershipFindUnique, grantCreate } = _Prisma();
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" }))
			.resolves.toEqual({ principalId: "principal-1", siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" });
		expect(principalFindUnique).toHaveBeenCalledWith({ where: { siloId_issuer_subject: { siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" } }, select: { id: true, siloId: true } });
		expect(membershipFindUnique).toHaveBeenCalledWith({ where: { clusterTenant_subject: { clusterTenant: "silo-a", subject: "subject-1" } }, select: { role: true, status: true } });
		expect(grantCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-a", managerId: "organization-membership-admin-bootstrap", subjectKind: "Principal", subjectPrincipalId: "principal-1", boundaryKind: "Personal", boundaryPrincipalId: "principal-1", boundaryCoverage: "Exact", catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID, catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION, catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST, capabilityId: "organization:administer", resourceKind: "organization", resourceId: "silo-a", effect: "Allow", priority: 0, createdBy: "principal-1" }) });
	});

	it("returns null when exact local resolution cannot observe the reconciled Principal", async function _RejectsStaleProjection()
	{
		const { prisma, membershipFindUnique, grantFindMany } = _Prisma(null);
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBeNull();
		expect(membershipFindUnique).not.toHaveBeenCalled();
		expect(grantFindMany).not.toHaveBeenCalled();
	});

	it("projects organization administration through the central authority in the identity transaction", async function _ReadsOrganizationAdministration()
	{
		const { prisma } = _Prisma();
		const listPrincipalEntitled = vi.fn().mockResolvedValue([{ kind: "organization", id: "silo-a" }]);
		const createAuthorization = vi.fn(function _CreateAuthorization() { return { listPrincipalEntitled } as unknown as AuthorizationAuthority; });
		const capability = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(prisma, { error: vi.fn() } as unknown as Logger, createAuthorization);

		await expect(capability.canAdministerOrganization({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBe(true);
		expect(createAuthorization).toHaveBeenCalledTimes(1);
		expect(listPrincipalEntitled).toHaveBeenCalledWith({ siloId: "silo-a", principalId: "principal-1", action: "read", resources: [{ kind: "organization", id: "silo-a" }], nowEpochMs: expect.any(Number) });
	});

	it("fails the capability projection closed when the central authority finds no grant", async function _DeniesOrganizationAdministration()
	{
		const { prisma } = _Prisma();
		const createAuthorization = vi.fn(function _CreateAuthorization() { return { listPrincipalEntitled: vi.fn().mockResolvedValue([]) } as unknown as AuthorizationAuthority; });
		const capability = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(prisma, { error: vi.fn() } as unknown as Logger, createAuthorization);

		await expect(capability.canAdministerOrganization({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBe(false);
	});

	it("rejects incomplete identity coordinates before opening a transaction", async function _RejectsIncompleteIdentity()
	{
		const { prisma } = _Prisma();
		const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, { warn: vi.fn() } as unknown as Logger);

		await expect(admission.admit({ siloId: "", issuer: "https://issuer.example", subject: "subject-1" })).resolves.toBeNull();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});
});
