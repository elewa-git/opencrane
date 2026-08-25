import { RevisionBoundaryCoverages, RevisionBoundaryKinds } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

import { PrismaBoundaryGrantRepository } from "../db/prisma-boundary-grant-resolver";

/** Builds one persisted generic grant row for resolver tests. */
function _Grant(overrides: Record<string, unknown> = {})
{
	return {
		id: "grant-allow",
		siloId: "silo-1",
		subjectKind: "Principal",
		subjectGroupId: null,
		subjectPrincipalId: "principal-1",
		boundaryKind: "Group",
		boundaryGroupId: "department-1",
		boundaryPrincipalId: null,
		boundaryCoverage: "Descendants",
		catalogId: "catalog-1",
		catalogRevision: 1,
		catalogDigest: `sha256:${"a".repeat(64)}`,
		capabilityId: "knowledge:read",
		resourceKind: "dataset",
		resourceId: "dataset-1",
		effect: "Allow",
		priority: 10,
		validFrom: new Date(500),
		expiresAt: null,
		revokedAt: null,
		...overrides,
	};
}

/** Creates the minimal Prisma authority surface consumed by the resolver. */
function _Prisma(grants: readonly ReturnType<typeof _Grant>[])
{
	return {
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1" }]), findUnique: vi.fn().mockResolvedValue({ id: "principal-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		group: { findMany: vi.fn().mockResolvedValue([{ id: "department-1", parentId: null }, { id: "team-1", parentId: "department-1" }]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
	};
}

const _TEAM_EXACT = [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "team-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }] as const;

describe("PrismaBoundaryGrantRepository", function _Suite()
{
	it("allows a child boundary through an active ancestor descendants grant", async function _AncestorAllow()
	{
		const resolver = new PrismaBoundaryGrantRepository(_Prisma([_Grant()]) as never);
		await expect(resolver.resolveEffectiveBoundaryGrants({ siloId: "silo-1", principalIds: ["principal-1"], attachments: _TEAM_EXACT, nowEpochMs: 1_000 })).resolves.toEqual(_TEAM_EXACT);
	});

	it("applies higher-priority deny precedence for the same capability and resource", async function _DenyWins()
	{
		const grants = [_Grant(), _Grant({ id: "grant-deny", boundaryGroupId: "team-1", boundaryCoverage: "Exact", effect: "Deny", priority: 20 })];
		const resolver = new PrismaBoundaryGrantRepository(_Prisma(grants) as never);
		await expect(resolver.resolveEffectiveBoundaryGrants({ siloId: "silo-1", principalIds: ["principal-1"], attachments: _TEAM_EXACT, nowEpochMs: 1_000 })).resolves.toEqual([]);
	});

	it("ignores expired allows and refuses to widen exact access into descendants", async function _ValidityAndCoverage()
	{
		const expired = new PrismaBoundaryGrantRepository(_Prisma([_Grant({ expiresAt: new Date(900) })]) as never);
		await expect(expired.resolveEffectiveBoundaryGrants({ siloId: "silo-1", principalIds: ["principal-1"], attachments: _TEAM_EXACT, nowEpochMs: 1_000 })).resolves.toEqual([]);

		const descendants = [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "team-1", boundaryCoverage: RevisionBoundaryCoverages.Descendants }] as const;
		const exact = new PrismaBoundaryGrantRepository(_Prisma([_Grant({ boundaryGroupId: "team-1", boundaryCoverage: "Exact" })]) as never);
		await expect(exact.resolveEffectiveBoundaryGrants({ siloId: "silo-1", principalIds: ["principal-1"], attachments: descendants, nowEpochMs: 1_000 })).resolves.toEqual([]);
	});
});
