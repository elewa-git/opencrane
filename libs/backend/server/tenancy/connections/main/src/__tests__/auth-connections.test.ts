import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _ConnectionsAuthRouter } from "../index.js";

/** Session shape the pod-token route reads. */
interface TestSession
{
	/** Authenticated user, or undefined for an anonymous request. */
	authUser?: { sub: string; email?: string };
}

/**
 * Build a Prisma stub whose tenant.findMany returns the given matches. `suspended` (when set)
 * makes `orgMembership.findUnique` report a Suspended status for the resolved (org, subject),
 * exercising the connect-path fail-closed on suspension.
 */
function _buildPrisma(matches: unknown[], suspended = false): PrismaClient
{
	return {
		tenant: { findMany: vi.fn().mockResolvedValue(matches) },
		orgMembership: { findUnique: vi.fn().mockResolvedValue(suspended ? { status: "Suspended" } : null) },
	} as unknown as PrismaClient;
}

/** Mount the auth router with an injected session for testing. */
function _buildApp(session: TestSession, prisma: PrismaClient): Express
{
	const app = express();
	app.use(express.json());
	app.use(function _injectSession(req: Request, _res: Response, next: NextFunction): void
	{
		(req as unknown as { session: TestSession }).session = session;
		next();
	});
	app.use("/auth", _ConnectionsAuthRouter(prisma));
	return app;
}

describe("GET /auth/gateway-resolve (identity-routing authority)", function _gatewayResolveSuite()
{
	it("returns only the verified identity and authoritative in-cluster target", async function _ok()
	{
		const prisma = _buildPrisma([{
			name: "alex.oc",
			clusterTenantRef: "acme",
		}]);
		const app = _buildApp({ authUser: { sub: "u1", email: "Alex@acme.com" } }, prisma);

		const res = await request(app).get("/auth/gateway-resolve");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			user: { email: "alex@acme.com", sub: "u1" },
			tenant: { name: "alex.oc", clusterTenantRef: "acme" },
			podService: { name: "openclaw-alex.oc", namespace: "opencrane-acme" },
		});
	});

	it("returns 401 without a session", async function _noSession()
	{
		const app = _buildApp({}, _buildPrisma([]));
		const res = await request(app).get("/auth/gateway-resolve");
		expect(res.status).toBe(401);
		expect(res.body.code).toBe("UNAUTHORIZED");
	});

	it("fails closed when the session has no email", async function _noEmail()
	{
		const app = _buildApp({ authUser: { sub: "u1" } }, _buildPrisma([]));
		const res = await request(app).get("/auth/gateway-resolve");
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("NO_EMAIL");
	});

	it("fails closed when no tenant matches", async function _noTenant()
	{
		const app = _buildApp({ authUser: { sub: "u1", email: "ghost@acme.com" } }, _buildPrisma([]));
		const res = await request(app).get("/auth/gateway-resolve");
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("NO_TENANT");
	});

	it("fails closed when the email matches more than one tenant", async function _ambiguous()
	{
		const prisma = _buildPrisma([
			{ name: "alex.oc", clusterTenantRef: "acme" },
			{ name: "alex-2.oc", clusterTenantRef: "acme" },
		]);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);

		const res = await request(app).get("/auth/gateway-resolve");

		expect(res.status).toBe(403);
		expect(res.body.code).toBe("AMBIGUOUS_TENANT");
	});

	it("scopes resolution to the silo derived from the request host", async function _hostScoped()
	{
		const prisma = _buildPrisma([{ name: "alex.oc", clusterTenantRef: "elewa-be" }]);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);

		const res = await request(app)
			.get("/auth/gateway-resolve")
			.set("x-forwarded-host", "elewa-be.dev.opencrane.ai");

		expect(res.status).toBe(200);
		expect((prisma.tenant.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
			where: { email: { equals: "alex@acme.com", mode: "insensitive" }, clusterTenantRef: "elewa-be" },
		}));
	});

	it("fails closed when the resolved member is suspended", async function _suspended()
	{
		const prisma = _buildPrisma([{ name: "alex.oc", clusterTenantRef: "acme" }], true);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);

		const res = await request(app).get("/auth/gateway-resolve");

		expect(res.status).toBe(403);
		expect(res.body.code).toBe("MEMBER_SUSPENDED");
	});
});

describe("POST /auth/pod-token (OpenClaw connection broker)", function _suite()
{
	it("returns the gateway connection coordinates for the caller's tenant", async function _ok()
	{
		const prisma = _buildPrisma([{
			name: "alex.oc",
			ingressHost: "alex.oc.example.com",
		}]);
		const app = _buildApp({ authUser: { sub: "u1", email: "Alex@acme.com" } }, prisma);

		const res = await request(app).post("/auth/pod-token");

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			gatewayUrl: "wss://alex.oc.example.com/gateway",
			tenant: "alex.oc",
			ingressHost: "alex.oc.example.com",
		});
	});

	it("derives the gateway URL from ingressHost, routed at /gateway", async function _derived()
	{
		const prisma = _buildPrisma([{ name: "alex.oc", ingressHost: "alex.oc.example.com" }]);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);

		const res = await request(app).post("/auth/pod-token");

		expect(res.status).toBe(200);
		// Same-origin hosting: the SPA owns `/`, so the WS is exposed at `/gateway`.
		expect(res.body.gatewayUrl).toBe("wss://alex.oc.example.com/gateway");
	});

	it("returns 401 without a session", async function _noSession()
	{
		const app = _buildApp({}, _buildPrisma([]));
		const res = await request(app).post("/auth/pod-token");
		expect(res.status).toBe(401);
		expect(res.body.code).toBe("UNAUTHORIZED");
	});

	it("returns 403 when the session has no email", async function _noEmail()
	{
		const app = _buildApp({ authUser: { sub: "u1" } }, _buildPrisma([]));
		const res = await request(app).post("/auth/pod-token");
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("FORBIDDEN");
	});

	it("returns 403 when no tenant matches the session email", async function _noTenant()
	{
		const app = _buildApp({ authUser: { sub: "u1", email: "ghost@acme.com" } }, _buildPrisma([]));
		const res = await request(app).post("/auth/pod-token");
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("NO_TENANT");
	});

	it("fails closed with 409 when the email maps to more than one tenant", async function _ambiguous()
	{
		const prisma = _buildPrisma([
			{ name: "alex.oc", ingressHost: "a.example.com" },
			{ name: "alex2.oc", ingressHost: "b.example.com" },
		]);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);
		const res = await request(app).post("/auth/pod-token");
		expect(res.status).toBe(409);
		expect(res.body.code).toBe("AMBIGUOUS_TENANT");
	});

	it("scopes the tenant lookup to the silo in the request host so a multi-silo owner resolves", async function _hostScoped()
	{
		// A multi-silo owner: an unscoped lookup would be ambiguous (409). The request host
		// (`<clusterTenant>.<base>`) scopes the query to the silo being connected through.
		const prisma = _buildPrisma([{ name: "elewa-be-default", ingressHost: "elewa-be.dev.opencrane.ai" }]);
		const app = _buildApp({ authUser: { sub: "u1", email: "jente@elewa.ke" } }, prisma);

		const res = await request(app).post("/auth/pod-token").set("x-forwarded-host", "elewa-be.dev.opencrane.ai");

		expect(res.status).toBe(200);
		expect(res.body.tenant).toBe("elewa-be-default");
		expect((prisma.tenant.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
			where: { email: { equals: "jente@elewa.ke", mode: "insensitive" }, clusterTenantRef: "elewa-be" },
		}));
	});

	it("fails closed with 403 MEMBER_SUSPENDED when the resolved member is suspended (#126)", async function _suspended()
	{
		const prisma = _buildPrisma([{
			name: "alex.oc",
			ingressHost: "alex.oc.example.com",
			clusterTenantRef: "acme",
		}], true);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);

		const res = await request(app).post("/auth/pod-token");

		expect(res.status).toBe(403);
		expect(res.body.code).toBe("MEMBER_SUSPENDED");
	});

	it("returns 409 when the pod has no ingress host", async function _notReady()
	{
		const prisma = _buildPrisma([{ name: "alex.oc", ingressHost: null }]);
		const app = _buildApp({ authUser: { sub: "u1", email: "alex@acme.com" } }, prisma);
		const res = await request(app).post("/auth/pod-token");
		expect(res.status).toBe(409);
		expect(res.body.code).toBe("POD_NOT_READY");
	});
});
