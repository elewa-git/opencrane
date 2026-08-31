import { AgentServiceKind, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAgentRevisionLifecycleUnitOfWork } from "../db/prisma-agent-revision-lifecycle-unit-of-work";

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
		const transaction = { agentService: { findMany } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentRevisionLifecycleUnitOfWork(prisma, function _Authorization() { return { listPrincipalEntitled: vi.fn(async function _Entitled(command) { return command.resources; }) } as never; });

		await expect(repository.listManagedServices({ principalId: "principal-1", siloId: "silo-1" })).resolves.toEqual([{ id: "service-1", siloId: "silo-1", kind: "managed", name: "Research", state: "active", activeRevisionId: "revision-1", workloadProfile: "managed", createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T13:00:00.000Z" }]);
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", kind: AgentServiceKind.Managed }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 200 });
	});

	it("filters services without a current Discover grant", async function _FiltersUnauthorizedServices()
	{
		const hidden = { ..._serviceRow(), id: "service-hidden", name: "Hidden" };
		const transaction = { agentService: { findMany: vi.fn().mockResolvedValue([_serviceRow(), hidden]) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const listPrincipalEntitled = vi.fn().mockResolvedValue([{ kind: "agent-service", id: "service-1" }]);
		const repository = new PrismaAgentRevisionLifecycleUnitOfWork(prisma, function _Authorization() { return { listPrincipalEntitled } as never; });

		const services = await repository.listManagedServices({ principalId: "principal-1", siloId: "silo-1" });

		expect(services.map(service => service.id)).toEqual(["service-1"]);
		expect(listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", action: "discover", resources: [{ kind: "agent-service", id: "service-1" }, { kind: "agent-service", id: "service-hidden" }] }));
	});
});
