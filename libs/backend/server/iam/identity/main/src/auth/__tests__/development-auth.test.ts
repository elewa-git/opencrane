import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { TIER3_DEVELOPMENT_PROXY_PROOF_HEADER } from "@opencrane/contracts";
import { ___CreateBrowserSessionMiddleware } from "@opencrane/backend/server/infra/auth";

import { ___Tier3DevelopmentAuthRouter } from "../development-auth.router";
import { Tier3DevelopmentAuthService } from "../development-auth.service";
import type { Tier3DevelopmentAuthenticationConfig } from "../development-auth.types";

const _CONFIG: Tier3DevelopmentAuthenticationConfig = {
	displayName: "Tier 3 Developer",
	email: "owner@develop-smoke.opencrane.test",
	expectedHost: "smoke.develop-smoke.opencrane.test",
	issuer: "opencrane-tier3-development",
	proxySecret: "tier3-proxy-secret-with-at-least-32-bytes",
	sessionMaxAgeMilliseconds: 60_000,
	siloId: "smoke",
	subject: "tier3-development-user",
};

/** Builds the transaction surface used by Principal projection, Owner admission, and resolution. */
function _Fixture()
{
	let owner: { role: "Owner"; status: "Active"; subject: string } | null = null;
	const append = vi.fn();
	const transaction = {
		group: { findMany: vi.fn().mockResolvedValue([]) },
		groupMembership: { createMany: vi.fn(), deleteMany: vi.fn() },
		orgMembership: {
			create: vi.fn(async function _Create({ data }) { owner = { role: "Owner", status: "Active", subject: data.subject }; }),
			findFirst: vi.fn(async function _FindOwner() { return owner; }),
			findUnique: vi.fn(async function _FindSubject() { return owner; }),
		},
		principal: {
			findUnique: vi.fn().mockResolvedValue({ id: "principal-tier3", siloId: "smoke" }),
			upsert: vi.fn().mockResolvedValue({ id: "principal-tier3" }),
		},
	};
	const findAdminMemberships = vi.fn(async function _FindAdminMemberships()
	{
		return owner === null ? [] : [{ clusterTenant: "smoke", role: owner.role }];
	});
	const prisma = {
		$transaction: vi.fn(async function _Transaction(callback) { return callback(transaction); }),
	};
	const audit = { append };
	const log = { child: vi.fn(function _Child() { return log; }), warn: vi.fn() };
	return { append, audit, membership: { findAdminMemberships }, prisma, transaction, log };
}

/** Builds the small Express request session surface used by the development login service. */
function _Request(proof: string, host = _CONFIG.expectedHost)
{
	const session = {
		authUser: undefined as unknown,
		destroy: vi.fn(function _Destroy(callback) { callback(); }),
		regenerate: vi.fn(function _Regenerate(callback) { callback(); }),
		save: vi.fn(function _Save(callback) { callback(); }),
	};
	return {
		get: vi.fn(function _Get(name: string) { return name.toLowerCase() === "host" ? host : undefined; }),
		headers: { [TIER3_DEVELOPMENT_PROXY_PROOF_HEADER]: proof },
		session,
	};
}

/** Mounts the Tier 3 router with a service double so its public HTTP contract stays explicit. */
function _App(service: object)
{
	const app = express();
	app.use("/api/v1/auth", ___Tier3DevelopmentAuthRouter(service as never));
	return app;
}

describe("Tier 3 development authentication", function _Suite()
{
	it("projects and audits only the installation-selected identity before creating its session", async function _Login(): Promise<void>
	{
		const fixture = _Fixture();
		const service = new Tier3DevelopmentAuthService(_CONFIG, fixture.prisma as never, fixture.membership, fixture.audit as never, fixture.log as never);
		const request = _Request(_CONFIG.proxySecret);
		await expect(service.login(request as never, "/onboarding")).resolves.toBe("/onboarding");
		expect(fixture.transaction.principal.upsert).toHaveBeenCalledWith(expect.objectContaining({
			create: expect.objectContaining({ issuer: _CONFIG.issuer, siloId: _CONFIG.siloId, subject: _CONFIG.subject }),
		}));
		expect(fixture.append).toHaveBeenCalledTimes(1);
		expect(request.session.authUser).toMatchObject({
			emailVerified: false,
			issuer: _CONFIG.issuer,
			siloId: _CONFIG.siloId,
			sub: _CONFIG.subject,
		});
		await expect(service.getStatus(request as never)).resolves.toMatchObject({
			authenticated: true,
			mode: "development",
			user: {
				clusterTenant: "smoke",
				isOrgAdmin: true,
				ownedOrgs: [{ clusterTenant: "smoke", role: "owner" }],
			}
		});
		fixture.membership.findAdminMemberships.mockResolvedValue([]);
		await expect(service.getStatus(request as never)).resolves.toMatchObject({
			authenticated: true,
			user: { isOrgAdmin: false, ownedOrgs: [] },
		});
	});

	it("denies an absent, wrong, or wrong-host proof before durable identity work", async function _RejectProof(): Promise<void>
	{
		const fixture = _Fixture();
		const service = new Tier3DevelopmentAuthService(_CONFIG, fixture.prisma as never, fixture.membership, fixture.audit as never, fixture.log as never);
		await expect(service.login(_Request("wrong-proof-with-at-least-thirty-two-bytes") as never, "/")).resolves.toBeNull();
		await expect(service.login(_Request(_CONFIG.proxySecret, "attacker.test") as never, "/")).resolves.toBeNull();
		expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("sanitizes the return path and keeps owner admission idempotent", async function _Replay(): Promise<void>
	{
		const fixture = _Fixture();
		const service = new Tier3DevelopmentAuthService(_CONFIG, fixture.prisma as never, fixture.membership, fixture.audit as never, fixture.log as never);
		await expect(service.login(_Request(_CONFIG.proxySecret) as never, "//attacker.example")).resolves.toBe("/");
		await expect(service.login(_Request(_CONFIG.proxySecret) as never, "/chat")).resolves.toBe("/chat");
		expect(fixture.append).toHaveBeenCalledTimes(1);
	});

	it("rejects OIDC-only registration and callback semantics", async function _RejectOidcRoutes(): Promise<void>
	{
		const service = { getStatus: vi.fn(), login: vi.fn(), logout: vi.fn() };
		const promptResponse = await request(_App(service)).get("/api/v1/auth/login?prompt=create");
		expect(promptResponse.status).toBe(400);
		expect(promptResponse.body).toEqual({ error: "Registration prompts require OIDC.", code: "UNSUPPORTED_LOGIN_PROMPT" });
		expect(service.login).not.toHaveBeenCalled();

		const callbackResponse = await request(_App(service)).get("/api/v1/auth/callback?code=unused&state=unused");
		expect(callbackResponse.status).toBe(503);
		expect(service.login).not.toHaveBeenCalled();
	});

	it("requires an authenticated Tier 3 session before reauthentication", async function _RequiresSession(): Promise<void>
	{
		const service = {
			getStatus: vi.fn().mockReturnValue({ authenticated: false, mode: "development", user: null }),
			login: vi.fn(),
			logout: vi.fn(),
		};
		const response = await request(_App(service)).get("/api/v1/auth/reauthenticate?returnTo=%2Fsettings");
		expect(response.status).toBe(401);
		expect(service.login).not.toHaveBeenCalled();
	});

	it("establishes a signed session when a proved login crosses the session middleware and router", async function _SessionLogin(): Promise<void>
	{
		const fixture = _Fixture();
		const service = new Tier3DevelopmentAuthService(_CONFIG, fixture.prisma as never, fixture.membership, fixture.audit as never, fixture.log as never);
		const app = express();
		app.set("trust proxy", 1);
		app.use(...___CreateBrowserSessionMiddleware({
			cookieName: "opencrane_tier3_test",
			cookieSecure: true,
			sessionMaxAgeMs: _CONFIG.sessionMaxAgeMilliseconds,
			sessionSecret: "tier3-session-secret-with-at-least-32-bytes",
		}));
		app.use("/api/v1/auth", ___Tier3DevelopmentAuthRouter(service));
		const login = await request(app)
			.get("/api/v1/auth/login?returnTo=%2Fonboarding")
			.set("Host", _CONFIG.expectedHost)
			.set("X-Forwarded-Proto", "https")
			.set(TIER3_DEVELOPMENT_PROXY_PROOF_HEADER, _CONFIG.proxySecret)
			.redirects(0);
		expect(login.status).toBe(302);
		expect(login.headers.location).toBe("/onboarding");
		const sessionCookie = login.headers["set-cookie"]?.[0]?.split(";", 1)[0];
		expect(sessionCookie).toMatch(/^opencrane_tier3_test=/u);

		const status = await request(app)
			.get("/api/v1/auth/me")
			.set("Host", _CONFIG.expectedHost)
			.set("X-Forwarded-Proto", "https")
			.set("Cookie", sessionCookie as string);
		expect(status.status).toBe(200);
		expect(status.body).toMatchObject({
			authenticated: true,
			mode: "development",
			user: { issuer: _CONFIG.issuer, ownedOrgs: [{ clusterTenant: _CONFIG.siloId, role: "owner" }] },
		});
	});
});
