import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { _ResolveGatewayTarget } from "../../core/connections/gateway-resolve.js";

/**
 * Build a Prisma stub whose `tenant.findMany` returns the supplied matches. `suspendedMemberships`
 * lists the (clusterTenant, subject) pairs whose OrgMembership status is Suspended — everything
 * else resolves to Active (or a missing row ⇒ not suspended), matching the projected read-model.
 */
function _buildPrisma(matches: Array<{ name: string; clusterTenantRef: string | null }>,
	suspendedMemberships: Array<{ clusterTenant: string; subject: string }> = [])
{
	const findMany = vi.fn().mockResolvedValue(matches);
	const findUnique = vi.fn(async function _findUnique(args: { where: { clusterTenant_subject: { clusterTenant: string; subject: string } } })
	{
		const { clusterTenant, subject } = args.where.clusterTenant_subject;
		const suspended = suspendedMemberships.some(m => m.clusterTenant === clusterTenant && m.subject === subject);
		return suspended ? { status: "Suspended" } : null;
	});
	const prisma = { tenant: { findMany }, orgMembership: { findUnique } } as unknown as PrismaClient;
	return { prisma, findMany, findUnique };
}

describe("_ResolveGatewayTarget (DOMAIN.T4 routing authority)", function _suite()
{
	it("resolves the pod service in the org's bound namespace", async function ()
	{
		const { prisma } = _buildPrisma([{ name: "alice", clusterTenantRef: "acme" }]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "Alice@Example.com", "sub-1");

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.resolved.user).toEqual({ email: "alice@example.com", sub: "sub-1" });
		expect(outcome.resolved.tenant).toEqual({ name: "alice", clusterTenantRef: "acme" });
		// opencrane-<org> is the cross-app namespace contract; service name is openclaw-<tenant>.
		expect(outcome.resolved.podService).toEqual({ name: "openclaw-alice", namespace: "opencrane-acme" });
	});

	it("falls back to the control-plane namespace for a tenant with no org ref", async function ()
	{
		const { prisma } = _buildPrisma([{ name: "alice", clusterTenantRef: null }]);

		const outcome = await _ResolveGatewayTarget(prisma, "control-plane-ns", "alice@example.com", "sub-1");

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.resolved.podService.namespace).toBe("control-plane-ns");
	});

	it("falls back to email as the logged subject when sub is empty", async function ()
	{
		const { prisma } = _buildPrisma([{ name: "alice", clusterTenantRef: "acme" }]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "alice@example.com", "");

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.resolved.user.sub).toBe("alice@example.com");
	});

	it("fails closed with NO_EMAIL when the session has no email claim", async function ()
	{
		const { prisma, findMany } = _buildPrisma([]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", undefined, "sub-1");

		expect(outcome).toEqual({ ok: false, code: "NO_EMAIL" });
		// Never even queries on an empty email.
		expect(findMany).not.toHaveBeenCalled();
	});

	it("fails closed with NO_TENANT when no tenant matches", async function ()
	{
		const { prisma } = _buildPrisma([]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "ghost@example.com", "sub-1");

		expect(outcome).toEqual({ ok: false, code: "NO_TENANT" });
	});

	it("fails closed with AMBIGUOUS_TENANT when more than one tenant matches", async function ()
	{
		const { prisma } = _buildPrisma([
			{ name: "alice", clusterTenantRef: "acme" },
			{ name: "alice2", clusterTenantRef: "beta" },
		]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "shared@example.com", "sub-1");

		expect(outcome).toEqual({ ok: false, code: "AMBIGUOUS_TENANT" });
	});

	it("queries case-insensitively and caps the scan at two rows (ambiguity detection)", async function ()
	{
		const { prisma, findMany } = _buildPrisma([{ name: "alice", clusterTenantRef: "acme" }]);

		await _ResolveGatewayTarget(prisma, "default", "  Alice@Example.com  ", "sub-1");

		expect(findMany).toHaveBeenCalledWith({
			where: { email: { equals: "alice@example.com", mode: "insensitive" } },
			select: { name: true, clusterTenantRef: true },
			take: 2,
		});
	});

	it("fails closed with MEMBER_SUSPENDED when the resolved subject has a Suspended membership (#126)", async function ()
	{
		const { prisma } = _buildPrisma(
			[{ name: "alice", clusterTenantRef: "acme" }],
			[{ clusterTenant: "acme", subject: "sub-1" }],
		);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "alice@example.com", "sub-1", "acme");

		expect(outcome).toEqual({ ok: false, code: "MEMBER_SUSPENDED" });
	});

	it("allows a tenant with NO membership row (legacy/standalone — absence is not suspension)", async function ()
	{
		// A resolved tenant whose subject has no OrgMembership row must still connect.
		const { prisma } = _buildPrisma([{ name: "alice", clusterTenantRef: "acme" }], []);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "alice@example.com", "sub-1", "acme");

		expect(outcome.ok).toBe(true);
	});

	it("allows a tenant with no org ref (no membership scope ⇒ never suspended)", async function ()
	{
		const { prisma, findUnique } = _buildPrisma([{ name: "alice", clusterTenantRef: null }]);

		const outcome = await _ResolveGatewayTarget(prisma, "control-plane-ns", "alice@example.com", "sub-1");

		expect(outcome.ok).toBe(true);
		// No org ref ⇒ the suspension check short-circuits without a membership query.
		expect(findUnique).not.toHaveBeenCalled();
	});

	it("scopes the lookup to the given silo so a multi-silo owner routes to one pod", async function ()
	{
		// Globally ambiguous, but scoping to the connecting silo resolves to exactly its pod.
		const { prisma, findMany } = _buildPrisma([{ name: "elewa-be-default", clusterTenantRef: "elewa-be" }]);

		const outcome = await _ResolveGatewayTarget(prisma, "default", "jente@elewa.ke", "sub-1", "elewa-be");

		expect(outcome.ok).toBe(true);
		expect(findMany).toHaveBeenCalledWith({
			where: { email: { equals: "jente@elewa.ke", mode: "insensitive" }, clusterTenantRef: "elewa-be" },
			select: { name: true, clusterTenantRef: true },
			take: 2,
		});
	});
});
