import express, { type Express } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";

import { _CreateIntegrationCustodyRouter } from "../integration-custody.router";

/** Active same-silo integration row returned by the happy-path lookup. */
const _INTEGRATION_ROW = { id: "int-1", siloId: "silo-1", obotCatalogEntryId: "cat-1", displayName: "GitHub", state: "Active", createdAt: new Date(), updatedAt: new Date() };

/** Valid provisioning body carrying one write-only credential entry. */
const _BODY = { obotCatalogEntryId: "cat-1", credential: [{ name: "API_TOKEN", value: "write-only-secret" }] };

/** Builds a Prisma double covering the lookup and the custody persistence transaction. */
function _mockPrisma(integrationRow: unknown = _INTEGRATION_ROW)
{
	const custodyCreate = vi.fn().mockResolvedValue({ id: "custody-row-1" });
	const findUnique = vi.fn().mockResolvedValue(integrationRow);
	const transactionClient = { $queryRaw: vi.fn().mockResolvedValue([]), integration: { findUnique }, integrationCustodyReference: { create: custodyCreate } };
	const prisma = {
		integration: { findUnique },
		$transaction: vi.fn(async function _transaction(callback: (transaction: unknown) => Promise<unknown>) { return callback(transactionClient); }),
	} as unknown as PrismaClient;
	return { prisma, custodyCreate, findUnique };
}

/** Builds a recording custody port answering with one Obot-minted reference. */
function _mockCustody(): { custody: ObotCustodyPort; provision: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> }
{
	const provision = vi.fn().mockResolvedValue({ obotCatalogEntryId: "cat-1", obotCustodyReference: "srv-9", expiresAt: new Date("2099-01-01T00:00:00.000Z") });
	const revoke = vi.fn().mockResolvedValue(undefined);
	return { custody: { provision, revoke }, provision, revoke };
}

/** Mount the router with an optional seeded session user, mirroring the sibling MCP gate tests. */
function _buildApp(prisma: PrismaClient, custody: ObotCustodyPort, user?: { isOrgAdmin: boolean; sub?: string }): Express
{
	const app = express();
	app.use(express.json());
	if (user)
	{
		app.use(function _seedSession(req, _res, next)
		{
			(req as unknown as { session: { authUser: unknown } }).session = { authUser: { sub: "admin-1", authenticatedAt: "2026-01-01T00:00:00.000Z", ...user } };
			req.authenticatedPrincipal = { principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.test", subject: user.sub ?? "admin-1" };
			next();
		});
	}
	app.use("/api/v1/integrations", _CreateIntegrationCustodyRouter(prisma, custody, { warn: vi.fn(), error: vi.fn() }));
	return app;
}

describe("integration custody router", function _suite()
{
	it("provisions custody for an org admin and never echoes the credential", async function _happyPath()
	{
		const { prisma } = _mockPrisma();
		const { custody, provision } = _mockCustody();
		const response = await request(_buildApp(prisma, custody, { isOrgAdmin: true })).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
		expect(response.status).toBe(201);
		expect(response.body).toEqual({ outcome: "provisioned", custodyReferenceId: "custody-row-1" });
		expect(JSON.stringify(response.body)).not.toContain("write-only-secret");
		expect(provision).toHaveBeenCalledWith({ siloId: "silo-1", integrationId: "int-1", obotCatalogEntryId: "cat-1", credential: _BODY.credential });
	});

	it("denies non-admin and anonymous callers before any lookup", async function _orgAdminGate()
	{
		const { prisma, findUnique } = _mockPrisma();
		const { custody, provision } = _mockCustody();
		const member = await request(_buildApp(prisma, custody, { isOrgAdmin: false })).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
		const anonymous = await request(_buildApp(prisma, custody)).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
		expect(member.status).toBe(403);
		expect(anonymous.status).toBe(403);
		expect(findUnique).not.toHaveBeenCalled();
		expect(provision).not.toHaveBeenCalled();
	});

	it("answers 404 without contacting Obot for a foreign-silo, retired, or mismatched integration", async function _integrationGate()
	{
		for (const row of [null, { ..._INTEGRATION_ROW, siloId: "silo-other" }, { ..._INTEGRATION_ROW, state: "Retired" }, { ..._INTEGRATION_ROW, obotCatalogEntryId: "cat-other" }])
		{
			const { prisma } = _mockPrisma(row);
			const { custody, provision } = _mockCustody();
			const response = await request(_buildApp(prisma, custody, { isOrgAdmin: true })).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
			expect(response.status).toBe(404);
			expect(provision).not.toHaveBeenCalled();
		}
	});

	it("rejects malformed bodies before any lookup", async function _bodyValidation()
	{
		const { prisma, findUnique } = _mockPrisma();
		const { custody } = _mockCustody();
		const app = _buildApp(prisma, custody, { isOrgAdmin: true });
		for (const body of [{}, { obotCatalogEntryId: "cat-1" }, { obotCatalogEntryId: "cat-1", credential: [] }, { obotCatalogEntryId: "cat-1", credential: [{ name: "", value: "v" }] }, { obotCatalogEntryId: "cat-1", credential: [{ name: "n", value: "" }] }, { obotCatalogEntryId: "", credential: _BODY.credential }])
		{
			const response = await request(app).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(body);
			expect(response.status).toBe(400);
		}
		expect(findUnique).not.toHaveBeenCalled();
	});

	it("projects a fail-closed provisioning outcome as 503 without secret material", async function _unavailable()
	{
		const { prisma } = _mockPrisma();
		const provision = vi.fn().mockRejectedValue(new Error("Bearer write-only-secret"));
		const response = await request(_buildApp(prisma, { provision, revoke: vi.fn() }, { isOrgAdmin: true })).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
		expect(response.status).toBe(503);
		expect(response.body).toEqual({ outcome: "unavailable", reason: "remote_unavailable" });
		expect(JSON.stringify(response.body)).not.toContain("write-only-secret");
	});

	it("fails closed when the session carries no resolvable subject", async function _noPrincipal()
	{
		const { prisma, findUnique } = _mockPrisma();
		const { custody, provision } = _mockCustody();
		const response = await request(_buildApp(prisma, custody, { isOrgAdmin: true, sub: " " })).post("/api/v1/integrations/int-1/custody").set("host", "silo-1.opencrane.test").send(_BODY);
		expect(response.status).toBe(401);
		expect(findUnique).not.toHaveBeenCalled();
		expect(provision).not.toHaveBeenCalled();
	});
});
