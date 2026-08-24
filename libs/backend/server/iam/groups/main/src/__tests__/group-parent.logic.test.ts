import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { GroupMembershipAuthorities } from "@opencrane/contracts";

import { ExternalGroupMembershipMutationError, PrismaGroupUnitOfWork } from "../core/groups.logic";

/** Build a transaction-backed Prisma stub for group logic. */
function _MockPrisma(): {
	prisma: PrismaClient;
	groupCreate: ReturnType<typeof vi.fn>;
	groupFindFirst: ReturnType<typeof vi.fn>;
	groupUpdate: ReturnType<typeof vi.fn>;
	membershipCreateMany: ReturnType<typeof vi.fn>;
	membershipDeleteMany: ReturnType<typeof vi.fn>;
}
{
	const groupCreate = vi.fn().mockResolvedValue({ id: "child", name: "Engineering" });
	const groupFindFirst = vi.fn();
	const groupUpdate = vi.fn().mockResolvedValue({ id: "child" });
	const membershipCreateMany = vi.fn().mockResolvedValue({ count: 0 });
	const membershipDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
	const prisma = {
		$transaction: vi.fn(async function _Transaction(callback: (transaction: PrismaClient) => Promise<unknown>) { return callback(prisma as unknown as PrismaClient); }),
		group: { create: groupCreate, findFirst: groupFindFirst, update: groupUpdate },
		principal: { count: vi.fn().mockResolvedValue(0) },
		groupMembership: { createMany: membershipCreateMany, deleteMany: membershipDeleteMany },
		auditEntry: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
	} as unknown as PrismaClient;
	return { prisma, groupCreate, groupFindFirst, groupUpdate, membershipCreateMany, membershipDeleteMany };
}

describe("group hierarchy persistence", function _GroupHierarchyPersistence()
{
	it("creates a local group in the trusted silo with its parent", async function _CreateWithParent()
	{
		const { prisma, groupCreate, groupFindFirst } = _MockPrisma();
		const groups = new PrismaGroupUnitOfWork(prisma);
		groupFindFirst.mockResolvedValue({ id: "company" });
		await groups.create("silo-1", { name: "Engineering", membershipAuthority: GroupMembershipAuthorities.Local, parentId: "company" });
		expect(groupCreate).toHaveBeenCalledWith({ data: { siloId: "silo-1", name: "Engineering", membershipAuthority: "Local", parentId: "company" } });
	});

	it("replaces normalized direct memberships for a local group", async function _ReplaceLocalMemberships()
	{
		const { prisma, groupFindFirst, membershipDeleteMany, membershipCreateMany } = _MockPrisma();
		const groups = new PrismaGroupUnitOfWork(prisma);
		groupFindFirst.mockResolvedValue({ id: "child", name: "Engineering", parentId: null, membershipAuthority: "Local" });
		(prisma.principal.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
		await groups.update("silo-1", "child", { members: ["principal-b", "principal-a", "principal-a"] });
		expect(membershipDeleteMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", groupId: "child" } });
		expect(membershipCreateMany).toHaveBeenCalledWith({ data: [{ siloId: "silo-1", groupId: "child", principalId: "principal-a" }, { siloId: "silo-1", groupId: "child", principalId: "principal-b" }] });
	});

	it("rejects direct membership writes for externally managed groups", async function _RejectExternalMembershipWrite()
	{
		const { prisma, groupFindFirst } = _MockPrisma();
		const groups = new PrismaGroupUnitOfWork(prisma);
		groupFindFirst.mockResolvedValue({ id: "child", name: "Engineering", parentId: null, membershipAuthority: "External" });
		await expect(groups.update("silo-1", "child", { members: [] })).rejects.toBeInstanceOf(ExternalGroupMembershipMutationError);
	});

	it("returns normalized memberships without inherited parent membership", async function _ReadDirectMembership()
	{
		const { prisma, groupFindFirst } = _MockPrisma();
		const groups = new PrismaGroupUnitOfWork(prisma);
		groupFindFirst.mockResolvedValue({ id: "child", siloId: "silo-1", name: "Engineering", membershipAuthority: "External", description: null, memberships: [{ principalId: "principal-a" }], parentId: "company" });
		await expect(groups.get("silo-1", "child")).resolves.toEqual({ id: "child", siloId: "silo-1", name: "Engineering", membershipAuthority: GroupMembershipAuthorities.External, parentId: "company", description: undefined, members: ["principal-a"], memberCount: 1 });
	});
});
