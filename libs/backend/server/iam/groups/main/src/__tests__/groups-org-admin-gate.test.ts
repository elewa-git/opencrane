import express from "express";
import type { Express } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { groupsRouter } from "../routes/groups";

/** Authenticated durable Principal fixture. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1" };

/** Persisted group fixture returned by domain-owned lifecycle reads. */
function _Group(id = "group-1")
{
	return { id, siloId: "silo-1", name: "Test Group", membershipAuthority: "Local", parentId: null, description: null, memberships: [] };
}

/** Builds a recording Prisma surface for route-focused authorization tests. */
function _MockPrisma(): { prisma: PrismaClient; spies: Record<string, ReturnType<typeof vi.fn>> }
{
	const spies: Record<string, ReturnType<typeof vi.fn>> = {};
	const prisma = new Proxy({}, {
		get(_target, model)
		{
			if (model === "$transaction")
			{
				return async function _Transaction(callback: (transaction: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown>
				{
					return callback(prisma as unknown as Prisma.TransactionClient);
				};
			}
			return new Proxy({}, {
				get(_delegate, method)
				{
					const key = `${String(model)}.${String(method)}`;
					return (spies[key] ??= vi.fn().mockResolvedValue([]));
				},
			});
		},
	}) as unknown as PrismaClient;
	return { prisma, spies };
}

/** Creates a central-authority fake with independently controlled reads and writes. */
function _Authorization(allow: boolean): AuthorizationAuthority
{
	const decision = allow
		? { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow" as const, grantIds: ["grant-1"], rule: null, evidence: null }
		: { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant" as const, grantIds: [], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		admitPrincipalBatch: vi.fn(async function _AdmitBatch(commands) { return commands.map(function _Decision() { return decision; }); }),
		listEntitled: vi.fn(async command => allow ? command.resources : []),
		listPrincipalEntitled: vi.fn(async command => allow ? command.resources : []),
		listManagedGrants: vi.fn().mockResolvedValue([]),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Mounts the router with an explicit caller and transaction-bound authority factory. */
function _App(prisma: PrismaClient, authorization: AuthorizationAuthority, caller = _CALLER): Express
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/groups", groupsRouter(prisma, function _Caller() { return caller; }, function _AuthorizationFactory() { return authorization; }));
	return app;
}

describe("groups router central authorization", function _Suite()
{
	it("filters lifecycle-eligible groups through one batch authorization decision", async function _List()
	{
		const { prisma, spies } = _MockPrisma();
		spies["group.findMany"] = vi.fn().mockResolvedValue([_Group("group-1"), _Group("group-2")]);
		const authorization = _Authorization(true);

		const response = await request(_App(prisma, authorization)).get("/api/v1/groups").expect(200);

		expect(response.body).toHaveLength(2);
		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", resources: [{ kind: "group", id: "group-1" }, { kind: "group", id: "group-2" }] }));
	});

	it("hides a group when current grants deny the read", async function _DeniedRead()
	{
		const { prisma, spies } = _MockPrisma();
		spies["group.findFirst"] = vi.fn().mockResolvedValue(_Group());

		await request(_App(prisma, _Authorization(false))).get("/api/v1/groups/group-1").expect(404);
	});

	it("denies create without a collection grant and never writes the group", async function _DeniedCreate()
	{
		const { prisma, spies } = _MockPrisma();

		const response = await request(_App(prisma, _Authorization(false))).post("/api/v1/groups").send({ name: "Operations", membershipAuthority: "local", members: [] }).expect(403);

		expect(response.body.code).toBe("FORBIDDEN");
		expect(spies["group.create"]).toBeUndefined();
	});

	it("admits create and writes it through the same transaction", async function _AllowedCreate()
	{
		const { prisma, spies } = _MockPrisma();
		spies["principal.count"] = vi.fn().mockResolvedValue(0);
		spies["group.create"] = vi.fn().mockResolvedValue({ id: "group-1", name: "Operations" });
		spies["auditEntry.create"] = vi.fn().mockResolvedValue({});
		const authorization = _Authorization(true);

		await request(_App(prisma, authorization)).post("/api/v1/groups").send({ name: "Operations", membershipAuthority: "local", members: [] }).expect(201);

		expect(authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", resource: { kind: "organization", id: "silo-1" }, action: "administer" }));
		expect(spies["group.create"]).toHaveBeenCalledOnce();
		expect(spies["auditEntry.create"]).toHaveBeenCalledWith({ data: expect.objectContaining({ siloId: "silo-1" }) });
	});

	it("checks same-silo existence before admitting an update", async function _MissingUpdate()
	{
		const { prisma, spies } = _MockPrisma();
		spies["group.findFirst"] = vi.fn().mockResolvedValue(null);
		const authorization = _Authorization(true);

		await request(_App(prisma, authorization)).put("/api/v1/groups/missing").send({ name: "Changed" }).expect(404);

		expect(authorization.admitPrincipal).not.toHaveBeenCalled();
		expect(spies["group.update"]).toBeUndefined();
	});

	it("denies deletion before the protected write", async function _DeniedDelete()
	{
		const { prisma, spies } = _MockPrisma();
		spies["group.findFirst"] = vi.fn().mockResolvedValue(_Group());

		await request(_App(prisma, _Authorization(false))).delete("/api/v1/groups/group-1").expect(403);

		expect(spies["group.delete"]).toBeUndefined();
	});

	it("fails closed when the request has no admitted Principal", async function _NoCaller()
	{
		const { prisma, spies } = _MockPrisma();
		const app = express();
		app.use(express.json());
		app.use("/api/v1/groups", groupsRouter(prisma, function _NoCaller() { return null; }, function _AuthorizationFactory() { return _Authorization(true); }));

		await request(app).delete("/api/v1/groups/group-1").expect(403);
		expect(spies["group.delete"]).toBeUndefined();
	});
});
