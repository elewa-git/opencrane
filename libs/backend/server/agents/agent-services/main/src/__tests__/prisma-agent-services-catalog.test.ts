import { AgentServiceKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAgentRevisionLifecycleRepository } from "../prisma-agent-revision-lifecycle.js";

/** Creates the persisted fields mapped into one management catalogue service summary. */
function _serviceRow()
{
	return { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Managed, name: "Research", state: "Active", activeRevisionId: "revision-1", workloadProfile: "managed", createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T13:00:00.000Z") };
}

describe("Prisma managed agent services catalogue", function _suite()
{
	it("reads only managed services from the exact silo in a bounded deterministic order", async function _listsManagedSiloServices()
	{
		const findMany = vi.fn().mockResolvedValue([_serviceRow()]);
		const prisma = { agentService: { findMany } } as unknown as PrismaClient;
		const repository = new PrismaAgentRevisionLifecycleRepository(prisma);

		await expect(repository.listManagedServices("silo-1")).resolves.toEqual([{ id: "service-1", siloId: "silo-1", kind: "managed", name: "Research", state: "active", activeRevisionId: "revision-1", workloadProfile: "managed", createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T13:00:00.000Z" }]);
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", kind: AgentServiceKind.Managed }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200 });
	});
});
