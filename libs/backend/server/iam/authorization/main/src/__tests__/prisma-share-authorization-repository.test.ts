import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaShareAuthorizationRepository } from "../prisma-share-authorization-repository.js";

/** Creates one complete share row for adapter mapping assertions. */
function _shareRow(): Record<string, unknown>
{
	return {
		id: "grant-1",
		siloId: "silo-1",
		subjectId: "user-2",
		scopeKind: "Personal",
		organizationId: "silo-1",
		catalogId: "opencrane-core",
		catalogRevision: 1,
		catalogDigest: "sha256:catalog",
		capabilityId: "mcp-server:use",
		resourceKind: "mcp-server",
		resourceId: "server-1",
		createdBy: "user-1",
		createdAt: new Date("2026-08-01T00:00:00.000Z"),
	};
}

/** Builds a narrow Prisma stub owned by this adapter's tests. */
function _prisma(): PrismaClient
{
	return {
		capabilityCatalogRevision: { upsert: vi.fn(async function _upsert(input: { create: { digest: string } }) { return { digest: input.create.digest }; }) },
		authorizationGrant: {
			findFirst: vi.fn(async function _findFirst() { return _shareRow(); }),
			create: vi.fn(async function _create() { return _shareRow(); }),
			findMany: vi.fn(async function _findMany() { return [_shareRow()]; }),
			deleteMany: vi.fn(async function _deleteMany() { return { count: 1 }; }),
		},
	} as unknown as PrismaClient;
}

describe("PrismaShareAuthorizationRepository", function _suite()
{
	it("uses the catalog composite key and preserves the stored digest", async function _catalog()
	{
		const prisma = _prisma();
		const repository = new PrismaShareAuthorizationRepository(prisma);

		const digest = await repository.ensureCatalogRevision({ catalogId: "opencrane-core", revision: 1, digest: "sha256:catalog", capabilities: [{ id: "mcp-server:use", actions: ["use"] }], createdBy: "system:shares-bootstrap" });

		expect(digest).toBe("sha256:catalog");
		expect(vi.mocked(prisma.capabilityCatalogRevision.upsert)).toHaveBeenCalledWith(expect.objectContaining({ where: { catalogId_revision: { catalogId: "opencrane-core", revision: 1 } } }));
	});

	it("fails closed when an existing catalog revision has a different digest", async function _conflictingCatalog()
	{
		const prisma = _prisma();
		vi.mocked(prisma.capabilityCatalogRevision.upsert).mockResolvedValueOnce({ digest: "sha256:conflict" } as never);
		const repository = new PrismaShareAuthorizationRepository(prisma);

		await expect(repository.ensureCatalogRevision({ catalogId: "opencrane-core", revision: 1, digest: "sha256:catalog", capabilities: [{ id: "mcp-server:use", actions: ["use"] }], createdBy: "system:shares-bootstrap" })).rejects.toThrow("share capability catalog revision digest conflicts");
	});

	it("filters share listings and revocations by silo, sharer, catalog and capability", async function _silo()
	{
		const prisma = _prisma();
		const repository = new PrismaShareAuthorizationRepository(prisma);

		await repository.listActiveShares("silo-1", "user-1", "opencrane-core", "mcp-server:use");
		await repository.revokeOwnedShare("silo-1", "user-1", "grant-1");

		expect(vi.mocked(prisma.authorizationGrant.findMany)).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", createdBy: "user-1", catalogId: "opencrane-core", capabilityId: "mcp-server:use", revokedAt: null }) }));
		expect(vi.mocked(prisma.authorizationGrant.deleteMany)).toHaveBeenCalledWith({ where: { id: "grant-1", siloId: "silo-1", createdBy: "user-1" } });
	});

	it("uses the durable authority key, not the sharer, to find an idempotent share", async function _idempotency()
	{
		const prisma = _prisma();
		const repository = new PrismaShareAuthorizationRepository(prisma);

		const result = await repository.createOrFindExactShare({ siloId: "silo-1", subjectId: "user-2", scopeKind: "Personal", organizationId: "silo-1", catalogId: "opencrane-core", catalogRevision: 1, catalogDigest: "sha256:catalog", capabilityId: "mcp-server:use", resourceKind: "mcp-server", resourceId: "server-1", priority: 0, createdBy: "user-1" });

		expect(result.created).toBe(false);
		expect(vi.mocked(prisma.authorizationGrant.findFirst)).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ createdBy: expect.anything() }) }));
	});

	it("returns the winning concurrent insert after the durable unique constraint rejects this create", async function _concurrent()
	{
		const prisma = _prisma();
		vi.mocked(prisma.authorizationGrant.findFirst).mockResolvedValueOnce(null as never).mockResolvedValueOnce(_shareRow() as never);
		vi.mocked(prisma.authorizationGrant.create).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate authority", { code: "P2002", clientVersion: "6.19.3" }));
		const repository = new PrismaShareAuthorizationRepository(prisma);

		const result = await repository.createOrFindExactShare({ siloId: "silo-1", subjectId: "user-2", scopeKind: "Personal", organizationId: "silo-1", catalogId: "opencrane-core", catalogRevision: 1, catalogDigest: "sha256:catalog", capabilityId: "mcp-server:use", resourceKind: "mcp-server", resourceId: "server-1", priority: 0, createdBy: "user-1" });

		expect(result).toMatchObject({ created: false, share: { id: "grant-1" } });
		expect(vi.mocked(prisma.authorizationGrant.findFirst)).toHaveBeenCalledTimes(2);
	});
});
