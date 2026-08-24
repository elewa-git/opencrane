import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { _MirrorGroupsOnLogin, _ParseGroupClaims, PrismaGroupClaimProjectionUnitOfWork } from "../mirror-groups";

/** Logger spy used by group-claim reconciliation cases. */
const _log = { warn: vi.fn(), info: vi.fn() } as unknown as Logger;

/** Build a transaction-backed Prisma stub for stable-ID group reconciliation. */
function _MockPrisma(externalGroupIds: readonly string[]): {
	prisma: PrismaClient;
	principalUpsert: ReturnType<typeof vi.fn>;
	groupFindMany: ReturnType<typeof vi.fn>;
	membershipDeleteMany: ReturnType<typeof vi.fn>;
	membershipCreateMany: ReturnType<typeof vi.fn>;
}
{
	const principalUpsert = vi.fn().mockResolvedValue({ id: "principal-1" });
	const groupFindMany = vi.fn().mockResolvedValue(externalGroupIds.map(function _Group(id) { return { id }; }));
	const membershipDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
	const membershipCreateMany = vi.fn().mockResolvedValue({ count: externalGroupIds.length });
	const prisma = {
		$transaction: vi.fn(async function _Transaction(callback: (transaction: PrismaClient) => Promise<unknown>) { return callback(prisma as unknown as PrismaClient); }),
		principal: { upsert: principalUpsert },
		group: { findMany: groupFindMany },
		groupMembership: { deleteMany: membershipDeleteMany, createMany: membershipCreateMany },
	} as unknown as PrismaClient;
	return { prisma, principalUpsert, groupFindMany, membershipDeleteMany, membershipCreateMany };
}

describe("_ParseGroupClaims", function _ParseGroupClaimSuite()
{
	it("accepts only one stable group ID segment and de-duplicates without rewriting IDs", function _ParseStableIds()
	{
		expect(_ParseGroupClaims(["group:group-a", "operator", "group:department:engineering", "group:group-a", " group:Group-B "])).toEqual(["Group-B", "group-a"]);
	});

	it("rejects empty and missing claims", function _RejectEmptyClaims()
	{
		expect(_ParseGroupClaims(["group:", "group:a:b"])).toEqual([]);
		expect(_ParseGroupClaims(undefined)).toEqual([]);
	});
});

describe("_MirrorGroupsOnLogin", function _MirrorGroupsOnLoginSuite()
{
	it("projects the issuer-scoped Principal and reconciles resolved external group IDs", async function _ReconcileExternalGroups()
	{
		const { prisma, principalUpsert, groupFindMany, membershipDeleteMany, membershipCreateMany } = _MockPrisma(["group-a"]);
		await _MirrorGroupsOnLogin({ siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1", email: "person@example.com", displayName: "Person", groups: ["group:group-a"], log: _log }, new PrismaGroupClaimProjectionUnitOfWork(prisma));

		expect(principalUpsert).toHaveBeenCalledWith({
			where: { siloId_issuer_subject: { siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1" } },
			create: { siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1", email: "person@example.com", displayName: "Person" },
			update: { email: "person@example.com", displayName: "Person" },
			select: { id: true },
		});
		expect(groupFindMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", id: { in: ["group-a"] }, membershipAuthority: "External" }, select: { id: true } });
		expect(membershipDeleteMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", principalId: "principal-1", group: { membershipAuthority: "External" }, groupId: { notIn: ["group-a"] } } });
		expect(membershipCreateMany).toHaveBeenCalledWith({ data: [{ siloId: "silo-1", groupId: "group-a", principalId: "principal-1" }], skipDuplicates: true });
	});

	it("removes stale external memberships while the relation filter protects local memberships", async function _PruneExternalOnly()
	{
		const { prisma, membershipDeleteMany, membershipCreateMany } = _MockPrisma([]);
		await _MirrorGroupsOnLogin({ siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1", email: undefined, displayName: undefined, groups: [], log: _log }, new PrismaGroupClaimProjectionUnitOfWork(prisma));

		expect(membershipDeleteMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", principalId: "principal-1", group: { membershipAuthority: "External" } } });
		expect(membershipCreateMany).not.toHaveBeenCalled();
	});

	it("does not create groups for unknown or locally managed claimed IDs", async function _RejectUnresolvedIds()
	{
		const warn = vi.fn();
		const log = { warn, info: vi.fn() } as unknown as Logger;
		const { prisma, membershipCreateMany } = _MockPrisma([]);
		await _MirrorGroupsOnLogin({ siloId: "silo-1", issuer: "https://issuer.example", subject: "subject-1", email: undefined, displayName: undefined, groups: ["group:unknown"], log }, new PrismaGroupClaimProjectionUnitOfWork(prisma));

		expect(membershipCreateMany).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith({ siloId: "silo-1", subject: "subject-1", groupIds: ["unknown"] }, "OIDC group claims did not resolve to external groups in this silo");
	});

	it("performs no persistence without the full trusted identity tuple", async function _RequireIdentityTuple()
	{
		const { prisma, principalUpsert } = _MockPrisma([]);
		await _MirrorGroupsOnLogin({ siloId: "", issuer: "https://issuer.example", subject: "subject-1", email: undefined, displayName: undefined, groups: [], log: _log }, new PrismaGroupClaimProjectionUnitOfWork(prisma));
		expect(principalUpsert).not.toHaveBeenCalled();
	});
});
