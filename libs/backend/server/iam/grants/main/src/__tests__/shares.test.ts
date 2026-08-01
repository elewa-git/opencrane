import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sharesRouter } from "../routes/shares.js";

vi.mock("@opencrane/models/authorization", async () =>
{
	const actual = await vi.importActual("@opencrane/models/authorization");
	return { ...actual, __DecideAuthorization: vi.fn().mockReturnValue({ outcome: "deny", reason: "no_matching_grant" }) };
});

vi.mock("@opencrane/server/_infra/auth", () => ({
	_ResolveRequestPrincipal: vi.fn().mockReturnValue(null),
}));

import { __DecideAuthorization } from "@opencrane/models/authorization";
import { _ResolveRequestPrincipal } from "@opencrane/server/_infra/auth";

/** A captured authorizationGrant.create call's data, for assertions. */
let _lastCreate: Record<string, unknown> | null = null;

/** Build a Prisma stub for the shares route. */
function _prisma(opts: {
	mcpServerIds?: string[];
	groupIds?: string[];
	existingGrant?: Record<string, unknown> | null;
	myGrants?: Array<Record<string, unknown>>;
	grantById?: Record<string, { id: string; createdBy: string; siloId: string }>;
} = {}): { prisma: PrismaClient; deleted: string[] }
{
	const deleted: string[] = [];
	const prisma = {
		mcpServer: { findUnique: vi.fn(async (a: { where: { id: string } }) => (opts.mcpServerIds ?? []).includes(a.where.id) ? { id: a.where.id } : null) },
		group: { findUnique: vi.fn(async (a: { where: { id: string } }) => (opts.groupIds ?? []).includes(a.where.id) ? { id: a.where.id } : null) },
		capabilityCatalogRevision: {
			upsert: vi.fn(async (a: { create: Record<string, unknown> }) => ({ digest: a.create["digest"] })),
		},
		authorizationGrant: {
			findFirst: vi.fn(async () => opts.existingGrant ?? null),
			create: vi.fn(async (a: { data: Record<string, unknown> }) =>
			{
				_lastCreate = a.data;
				return { ...a.data, id: "grant-new", createdAt: new Date("2026-06-25T00:00:00Z") };
			}),
			findMany: vi.fn(async () => (opts.myGrants ?? []).map(function _mapGrant(g)
			{
				return {
					id: "z",
					resourceKind: "mcp-server",
					resourceId: "y",
					subjectId: "x",
					scopeKind: "Personal",
					createdBy: "caller-1",
					createdAt: new Date("2026-06-25T00:00:00Z"),
					...g,
				};
			})),
			deleteMany: vi.fn(async (a: { where: { id: string; createdBy: string; siloId: string } }) =>
			{
				const grant = opts.grantById?.[a.where.id];
				if (!grant || grant.createdBy !== a.where.createdBy || grant.siloId !== a.where.siloId) return { count: 0 };
				deleted.push(a.where.id);
				return { count: 1 };
			}),
		},
	} as unknown as PrismaClient;
	return { prisma, deleted };
}

/** Build a test app mounting the shares router. */
function _app(prisma: PrismaClient, caller?: { subjectId: string; siloId: string }): Express
{
	const app = express();
	app.use(express.json());
	if (caller)
	{
		vi.mocked(_ResolveRequestPrincipal).mockReturnValue({ subjectId: caller.subjectId, siloId: caller.siloId, isOrgAdmin: false } as never);
	}
	else
	{
		vi.mocked(_ResolveRequestPrincipal).mockReturnValue(null);
	}
	app.use("/api/v1/shares", sharesRouter(prisma));
	return app;
}

const _CALLER = { subjectId: "user:caller-1", siloId: "silo-1" };

describe("sharesRouter — inter-user sharing (S4, AuthorizationGrant)", function _suite()
{
	beforeEach(function _resetGate()
	{
		vi.mocked(__DecideAuthorization).mockReset().mockReturnValue({ outcome: "deny", reason: "no_matching_grant" } as never);
		vi.mocked(_ResolveRequestPrincipal).mockReset().mockReturnValue(null);
		_lastCreate = null;
	});

	it("401s when the caller is unauthenticated", async function _unauth()
	{
		const { prisma } = _prisma({ mcpServerIds: ["mcp-1"] });
		const res = await request(_app(prisma)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "user", recipientId: "bob" });
		expect(res.status).toBe(401);
	});

	it("400s on an invalid body (bad enum / missing fields)", async function _bad()
	{
		const { prisma } = _prisma();
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "nope", payloadId: "", recipientType: "user", recipientId: "" });
		expect(res.status).toBe(400);
	});

	it("404s when the payload does not exist", async function _noPayload()
	{
		const { prisma } = _prisma({ mcpServerIds: [] });
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "user", recipientId: "bob" });
		expect(res.status).toBe(404);
	});

	it("403s when the caller does not hold an Allow on the payload (least-privilege gate)", async function _gate()
	{
		vi.mocked(__DecideAuthorization).mockReturnValue({ outcome: "deny", reason: "no_matching_grant" } as never);
		const { prisma } = _prisma({ mcpServerIds: ["mcp-1"] });
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "user", recipientId: "bob" });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("FORBIDDEN");
	});

	it("creates an AuthorizationGrant on the recipient when the caller holds the payload (201)", async function _create()
	{
		vi.mocked(__DecideAuthorization).mockReturnValue({ outcome: "allow" } as never);
		const { prisma } = _prisma({ mcpServerIds: ["mcp-1"] });
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "user", recipientId: "bob" });
		expect(res.status).toBe(201);
		expect(_lastCreate).toMatchObject({ resourceKind: "mcp-server", resourceId: "mcp-1", subjectId: "bob", effect: "Allow", createdBy: "user:caller-1", siloId: "silo-1" });
		expect(res.body.recipientId).toBe("bob");
	});

	it("404s a group recipient that does not exist", async function _noGroup()
	{
		vi.mocked(__DecideAuthorization).mockReturnValue({ outcome: "allow" } as never);
		const { prisma } = _prisma({ mcpServerIds: ["mcp-1"], groupIds: [] });
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "group", recipientId: "ghost" });
		expect(res.status).toBe(404);
	});

	it("is idempotent — an identical existing grant is returned with 200, no duplicate", async function _idem()
	{
		vi.mocked(__DecideAuthorization).mockReturnValue({ outcome: "allow" } as never);
		const { prisma } = _prisma({
			mcpServerIds: ["mcp-1"],
			existingGrant: { id: "grant-existing", resourceKind: "mcp-server", resourceId: "mcp-1", subjectId: "bob", scopeKind: "Personal", createdBy: "user:caller-1", createdAt: new Date("2026-06-01T00:00:00Z") },
		});
		const res = await request(_app(prisma, _CALLER)).post("/api/v1/shares").send({ payloadType: "mcp-server", payloadId: "mcp-1", recipientType: "user", recipientId: "bob" });
		expect(res.status).toBe(200);
		expect(res.body.id).toBe("grant-existing");
	});

	it("revoke deletes only a grant the caller created; another's grant 404s and is untouched", async function _revoke()
	{
		const { prisma, deleted } = _prisma({
			grantById: {
				mine: { id: "mine", createdBy: "user:caller-1", siloId: "silo-1" },
				theirs: { id: "theirs", createdBy: "someone-else", siloId: "silo-1" },
			},
		});

		const notMine = await request(_app(prisma, _CALLER)).delete("/api/v1/shares/theirs");
		expect(notMine.status).toBe(404);
		expect(deleted).not.toContain("theirs");

		const mine = await request(_app(prisma, _CALLER)).delete("/api/v1/shares/mine");
		expect(mine.status).toBe(200);
		expect(deleted).toContain("mine");
	});
});
