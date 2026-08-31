import { PrincipalProvenance, type PrismaClient } from "@prisma/client";
import { AuthorizationBoundaryKinds, AuthorizationSubjectKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthorizationGrantRepository } from "../prisma-authorization-grants";

describe("Prisma authorization grant reader", function _suite()
{
	it("maps principal and group-boundary coordinates", async function _mapping()
	{
		const findMany = vi.fn().mockResolvedValue([{
			id: "grant-1", siloId: "silo-1", subjectKind: "Principal", subjectGroupId: null, subjectPrincipalId: "principal-1",
			boundaryKind: "Group", boundaryGroupId: "project-1", boundaryPrincipalId: null, boundaryCoverage: "Descendants",
			catalogId: "catalog-1", catalogRevision: 1, catalogDigest: `sha256:${"1".repeat(64)}`, capabilityId: "artifact.read",
			resourceKind: "artifact", resourceId: "artifact-1", effect: "Allow", priority: 10, validFrom: new Date("2026-07-18T00:00:00.000Z"), expiresAt: null, revokedAt: null, createdBy: "principal-2",
		}]);
		const repository = new PrismaAuthorizationGrantRepository({ authorizationGrant: { findMany } } as unknown as PrismaClient);
		const subjects = [{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" }] as const;
		const grants = await repository.listSubjectGrants("silo-1", subjects);
		expect(grants[0]).toMatchObject({ subject: subjects[0], boundary: { kind: AuthorizationBoundaryKinds.Group, groupId: "project-1" } });
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", OR: [{ subjectKind: "Principal", subjectPrincipalId: "principal-1", subjectGroupId: null }] }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
	});

	it("resolves only direct group memberships for a local principal", async function _directMembership()
	{
		const principal = { findUnique: vi.fn().mockResolvedValue({ id: "principal-1", subject: "agent-service-1", provenance: PrincipalProvenance.Internal }) };
		const groupMembership = { findMany: vi.fn().mockResolvedValue([{ groupId: "team-1" }]) };
		const repository = new PrismaAuthorizationGrantRepository({ principal, groupMembership } as unknown as PrismaClient);
		expect(await repository.resolvePrincipalSubjects("silo-1", "principal-1")).toEqual([
			{ kind: AuthorizationSubjectKinds.Principal, principalId: "principal-1" },
			{ kind: AuthorizationSubjectKinds.Group, groupId: "team-1" },
		]);
	});

	it("denies an external Principal whose durable organisation membership is not active", async function _InactiveMembership()
	{
		const principal = { findUnique: vi.fn().mockResolvedValue({ id: "principal-1", subject: "subject-1", provenance: PrincipalProvenance.External }) };
		const orgMembership = { findFirst: vi.fn().mockResolvedValue(null) };
		const groupMembership = { findMany: vi.fn() };
		const repository = new PrismaAuthorizationGrantRepository({ principal, orgMembership, groupMembership } as unknown as PrismaClient);
		expect(await repository.resolvePrincipalSubjects("silo-1", "principal-1")).toEqual([]);
		expect(groupMembership.findMany).not.toHaveBeenCalled();
	});

	it("loads persisted parent ancestry and detects cycles", async function _ancestry()
	{
		const group = { findMany: vi.fn().mockResolvedValue([{ id: "team-1", parentId: "department-1" }, { id: "department-1", parentId: "root" }, { id: "root", parentId: null }]) };
		const repository = new PrismaAuthorizationGrantRepository({ group } as unknown as PrismaClient);
		await expect(repository.resolveBoundaryContext("silo-1", { kind: AuthorizationBoundaryKinds.Group, groupId: "team-1" })).resolves.toEqual({ requestedGroupAncestorIds: ["department-1", "root"] });
	});
});
