import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { GrantScope } from "@opencrane/contracts";

import { createGroup, getGroup, updateGroup } from "../core/groups.logic";

function _MockPrisma(): {
	prisma: PrismaClient;
	groupCreate: ReturnType<typeof vi.fn>;
	groupFindUnique: ReturnType<typeof vi.fn>;
	groupUpdate: ReturnType<typeof vi.fn>;
}
{
	const groupCreate = vi.fn().mockResolvedValue({ id: "child", name: "Engineering" });
	const groupFindUnique = vi.fn();
	const groupUpdate = vi.fn().mockResolvedValue({ id: "child" });
	const auditCreate = vi.fn().mockResolvedValue({ id: "audit" });

	return {
		prisma: {
			group: {
				create: groupCreate,
				findUnique: groupFindUnique,
				update: groupUpdate,
			},
			auditEntry: { create: auditCreate },
		} as unknown as PrismaClient,
		groupCreate,
		groupFindUnique,
		groupUpdate,
	};
}

describe("group hierarchy persistence", function _GroupHierarchyPersistence()
{
	it("persists a parent when a group is created", async function _CreateWithParent()
	{
		const { prisma, groupCreate } = _MockPrisma();

		await createGroup(prisma, {
			name: "Engineering",
			scope: "department",
			parentId: "company",
			members: [],
		});

		expect(groupCreate).toHaveBeenCalledWith({
			data: expect.objectContaining({ parentId: "company" }),
		});
	});

	it("detaches a group only when parentId is explicitly null", async function _DetachParent()
	{
		const { prisma, groupUpdate } = _MockPrisma();

		await updateGroup(prisma, "child", { parentId: null });
		expect(groupUpdate).toHaveBeenLastCalledWith({
			where: { id: "child" },
			data: { parentId: null },
		});

		await updateGroup(prisma, "child", { description: "Platform team" });
		expect(groupUpdate).toHaveBeenLastCalledWith({
			where: { id: "child" },
			data: { description: "Platform team" },
		});
	});

	it("returns the persisted parent without inheriting membership or grants", async function _ReadParent()
	{
		const { prisma, groupFindUnique } = _MockPrisma();
		groupFindUnique.mockResolvedValue({
			id: "child",
			name: "Engineering",
			scope: "Department",
			description: null,
			members: ["user-b", "user-a"],
			parentId: "company",
		});

		await expect(getGroup(prisma, "child")).resolves.toEqual({
			id: "child",
			name: "Engineering",
			scope: GrantScope.Department,
			parentId: "company",
			description: undefined,
			members: ["user-a", "user-b"],
			memberCount: 2,
			grants: [],
		});
	});
});
