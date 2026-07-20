import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _PropagatePolicyToCognee, _ResolvePolicyAffectedTenants, _SyncTenantAwarenessGrants } from "../core/cognee-awareness-sync.js";
import type { CogneeAwarenessGrant, CogneeGrantTransport } from "../core/cognee-awareness-sync.types.js";

/** Build a grant row in the shape the compiler selects. */
function _grant(over: Partial<{ id: string; payloadId: string; access: string; priority: number; scope: string }>)
{
	return {
		id: over.id ?? "g1",
		payloadType: "Awareness",
		payloadId: over.payloadId ?? "doc-1",
		access: over.access ?? "Allow",
		priority: over.priority ?? 0,
		scope: over.scope ?? "Project",
		subjectType: "Tenant",
		subjectId: "t1",
		createdAt: new Date("2026-06-01T00:00:00Z"),
	};
}

/** Prisma stub: no groups; grant.findMany returns the given awareness grants. */
function _prismaWithGrants(grants: ReturnType<typeof _grant>[]): PrismaClient
{
	return {
		group: { findMany: vi.fn().mockResolvedValue([]) },
		grant: { findMany: vi.fn().mockResolvedValue(grants) },
	} as unknown as PrismaClient;
}

/** A transport recording its calls; optionally fails for named tenants. */
function _spyTransport(failFor: string[] = []): CogneeGrantTransport & { calls: Array<{ tenant: string; grants: CogneeAwarenessGrant[] }> }
{
	const calls: Array<{ tenant: string; grants: CogneeAwarenessGrant[] }> = [];
	const fn = function _t(tenant: string, grants: CogneeAwarenessGrant[]): Promise<void>
	{
		calls.push({ tenant, grants });
		return failFor.includes(tenant) ? Promise.reject(new Error("cognee 503")) : Promise.resolve();
	};
	return Object.assign(fn, { calls });
}

describe("_SyncTenantAwarenessGrants (P4B.2)", function _suite()
{
	it("compiles awareness grants and pushes allow/deny decisions to Cognee", async function _push()
	{
		const prisma = _prismaWithGrants([
			_grant({ id: "g1", payloadId: "doc-1", access: "Allow", scope: "Org" }),
			_grant({ id: "g2", payloadId: "doc-2", access: "Deny", scope: "Project" }),
		]);
		const transport = _spyTransport();

		const result = await _SyncTenantAwarenessGrants(prisma, "t1", "Bearer x", transport);

		expect(result).toMatchObject({ tenant: "t1", allowed: 1, denied: 1, ok: true });
		expect(transport.calls[0].tenant).toBe("t1");
		// Scope is the compiler's lowercase enum value (org/project/…).
		expect(transport.calls[0].grants).toEqual(expect.arrayContaining([
			{ payloadId: "doc-1", access: "allow", scope: "org" },
			{ payloadId: "doc-2", access: "deny", scope: "project" },
		]));
	});

	it("captures (does not throw) a transport failure so the upstream write is not blocked", async function _fail()
	{
		const prisma = _prismaWithGrants([_grant({})]);
		const result = await _SyncTenantAwarenessGrants(prisma, "t1", undefined, _spyTransport(["t1"]));
		expect(result.ok).toBe(false);
		expect(result.error).toContain("cognee 503");
	});
});

describe("_ResolvePolicyAffectedTenants (P4B.2)", function _suite()
{
	it("resolves tenants by matchTeam", async function _team()
	{
		const findMany = vi.fn().mockResolvedValue([{ name: "a" }, { name: "b" }]);
		const prisma = {
			accessPolicy: { findUnique: vi.fn().mockResolvedValue({ tenantSelector: { matchTeam: "platform" } }) },
			tenant: { findMany },
		} as unknown as PrismaClient;

		const tenants = await _ResolvePolicyAffectedTenants(prisma, "pol");
		expect(tenants).toEqual(["a", "b"]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ team: "platform" }] } }));
	});

	it("resolves a tenant by the opencrane.io/tenant name label", async function _name()
	{
		const findMany = vi.fn().mockResolvedValue([{ name: "alex" }]);
		const prisma = {
			accessPolicy: { findUnique: vi.fn().mockResolvedValue({ tenantSelector: { matchLabels: { "opencrane.io/tenant": "alex" } } }) },
			tenant: { findMany },
		} as unknown as PrismaClient;

		expect(await _ResolvePolicyAffectedTenants(prisma, "pol")).toEqual(["alex"]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ name: "alex" }] } }));
	});

	it("returns [] for a non-DB-resolvable selector (arbitrary labels) without querying tenants", async function _arbitrary()
	{
		const findMany = vi.fn();
		const prisma = {
			accessPolicy: { findUnique: vi.fn().mockResolvedValue({ tenantSelector: { matchLabels: { region: "eu" } } }) },
			tenant: { findMany },
		} as unknown as PrismaClient;

		expect(await _ResolvePolicyAffectedTenants(prisma, "pol")).toEqual([]);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("returns [] when the policy does not exist", async function _missing()
	{
		const prisma = { accessPolicy: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
		expect(await _ResolvePolicyAffectedTenants(prisma, "pol")).toEqual([]);
	});
});

describe("_PropagatePolicyToCognee (P4B.2)", function _suite()
{
	it("syncs each affected tenant and counts per-tenant failures", async function _propagate()
	{
		const prisma = _prismaWithGrants([_grant({})]);
		const transport = _spyTransport(["t2"]);

		const result = await _PropagatePolicyToCognee(prisma, "pol", ["t1", "t2"], undefined, transport);

		expect(result.tenants).toEqual(["t1", "t2"]);
		expect(result.failures).toBe(1);
		expect(transport.calls.map(function _c(c) { return c.tenant; })).toEqual(["t1", "t2"]);
	});
});
