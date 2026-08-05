import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMcpServerMutationUnitOfWork } from "../core/prisma-mcp-server-mutation-unit-of-work.js";

/** Builds the narrow aggregate delegate stub used by this adapter test. */
function _prisma(): PrismaClient
{
	const mcpServer = {
		create: vi.fn(async function _create() { return { id: "server-1", name: "Example server" }; }),
		update: vi.fn(async function _update() { return { id: "server-1" }; }),
		delete: vi.fn(async function _delete() { return { id: "server-1" }; }),
	};
	const credentials = {
		deleteMany: vi.fn(async function _deleteMany() { return { count: 0 }; }),
		createMany: vi.fn(async function _createMany() { return { count: 0 }; }),
	};
	const auditEntry = { create: vi.fn(async function _createAudit() { return { id: "audit-1" }; }) };
	return {
		mcpServer,
		mcpServerCredential: credentials,
		auditEntry,
		$transaction: vi.fn(async function _transaction(callback: (transaction: { mcpServer: typeof mcpServer; mcpServerCredential: typeof credentials; auditEntry: typeof auditEntry }) => Promise<unknown>) { return callback({ mcpServer, mcpServerCredential: credentials, auditEntry }); }),
	} as unknown as PrismaClient;
}

describe("PrismaMcpServerMutationUnitOfWork", function _suite()
{
	it("creates the server, its credential metadata, and audit record inside one transaction", async function _create()
	{
		const prisma = _prisma();
		const repository = new PrismaMcpServerMutationUnitOfWork(prisma);

		await repository.createServer({ name: "Example server", description: "", endpoint: "https://mcp.example.test", scope: "Org", transport: "StreamableHttp", status: "Draft", capabilities: [], credentials: [{ displayName: "Personal OAuth" }] });

		expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.mcpServer.create)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.mcpServerCredential.deleteMany)).toHaveBeenCalledWith({ where: { mcpServerId: "server-1" } });
		expect(vi.mocked(prisma.mcpServerCredential.createMany)).toHaveBeenCalledWith({ data: [{ mcpServerId: "server-1", displayName: "Personal OAuth" }] });
		expect(vi.mocked(prisma.auditEntry.create)).toHaveBeenCalledOnce();
	});

	it("updates the parent before replacing its credential set in the same transaction", async function _update()
	{
		const prisma = _prisma();
		const repository = new PrismaMcpServerMutationUnitOfWork(prisma);

		await repository.updateServer({ id: "server-1", credentials: [] });

		expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.mcpServer.update)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.mcpServerCredential.createMany)).not.toHaveBeenCalled();
		expect(vi.mocked(prisma.auditEntry.create)).toHaveBeenCalledOnce();
	});

	it("deletes children, parent, and audit record through one transaction", async function _delete()
	{
		const prisma = _prisma();
		const repository = new PrismaMcpServerMutationUnitOfWork(prisma);

		await repository.deleteServer("server-1");

		expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.mcpServerCredential.deleteMany)).toHaveBeenCalledWith({ where: { mcpServerId: "server-1" } });
		expect(vi.mocked(prisma.mcpServer.delete)).toHaveBeenCalledWith({ where: { id: "server-1" } });
		expect(vi.mocked(prisma.auditEntry.create)).toHaveBeenCalledOnce();
	});

	it("propagates a rejected child write from the transaction before a partial mutation can commit", async function _childFailure()
	{
		const prisma = _prisma();
		vi.mocked(prisma.mcpServerCredential.createMany).mockRejectedValueOnce(new Error("constraint failure"));
		const repository = new PrismaMcpServerMutationUnitOfWork(prisma);

		await expect(repository.createServer({ name: "Example server", description: "", endpoint: "https://mcp.example.test", scope: "Org", transport: "StreamableHttp", status: "Draft", capabilities: [], credentials: [{ displayName: "Personal OAuth" }] })).rejects.toThrow("constraint failure");

		expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
		expect(vi.mocked(prisma.auditEntry.create)).not.toHaveBeenCalled();
	});

	it("propagates a rejected audit write from the same transaction", async function _auditFailure()
	{
		const prisma = _prisma();
		vi.mocked(prisma.auditEntry.create).mockRejectedValueOnce(new Error("audit failure"));
		const repository = new PrismaMcpServerMutationUnitOfWork(prisma);

		await expect(repository.updateServer({ id: "server-1", credentials: [] })).rejects.toThrow("audit failure");

		expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
	});
});
