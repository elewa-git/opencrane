import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ___DevelopmentAuthMiddleware } from "../development-auth-middleware";
import type { AuthenticatedPrincipalAdmissionInput } from "../authenticated-principal-admission.types";

const _AUTHORITY: AuthenticatedPrincipalAdmissionInput = {
	issuer: "opencrane-tier3-development",
	siloId: "smoke",
	subject: "tier3-development-user",
};
const _EXPECTED_HOST = "smoke.develop-smoke.opencrane.test";

/** Builds an app with a caller-selected session and durable Principal admission result. */
function _App(user: Record<string, unknown> | null, admit: ReturnType<typeof vi.fn>, warn = vi.fn())
{
	const app = express();
	app.use(function _Session(request, _response, next)
	{
		if (user !== null)
			request.session = { authUser: user } as never;
		next();
	});
	app.use(rateLimit());
	app.use(___DevelopmentAuthMiddleware({ admit } as never, _AUTHORITY, _EXPECTED_HOST, { warn } as never));
	app.get("/protected", function _Protected(request, response)
	{
		response.json({ host: request.headers["x-forwarded-host"], principal: request.authenticatedPrincipal });
	});
	return app;
}

/** Returns a current session whose identity exactly matches the installed Tier 3 authority. */
function _User(overrides: Record<string, unknown> = {})
{
	return {
		authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		issuer: _AUTHORITY.issuer,
		siloId: _AUTHORITY.siloId,
		sub: _AUTHORITY.subject,
		...overrides,
	};
}

describe("development authentication middleware", function _Suite()
{
	it("admits the exact durable tuple selected at startup", async function _Admit(): Promise<void>
	{
		const admit = vi.fn().mockResolvedValue({ principalId: "principal-tier3", issuer: _AUTHORITY.issuer, siloId: _AUTHORITY.siloId, subject: _AUTHORITY.subject });
		const response = await request(_App(_User(), admit)).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(200);
		expect(response.body.host).toBe(_EXPECTED_HOST);
		expect(response.body.principal.principalId).toBe("principal-tier3");
	});

	it("rejects the installed identity on a different request host", async function _RejectHost(): Promise<void>
	{
		const admission = vi.fn().mockResolvedValue({ principalId: "principal-tier3", issuer: _AUTHORITY.issuer, siloId: _AUTHORITY.siloId, subject: _AUTHORITY.subject });
		await request(_App(_User(), admission)).get("/protected").set("x-forwarded-host", "other.develop-smoke.opencrane.test").expect(401);
		expect(admission).not.toHaveBeenCalled();
	});

	it("rejects expired, mismatched, missing, unavailable, and unresolved identity state", async function _Reject(): Promise<void>
	{
		const admission = vi.fn().mockResolvedValue({ principalId: "principal-tier3", issuer: _AUTHORITY.issuer, siloId: _AUTHORITY.siloId, subject: _AUTHORITY.subject });
		await request(_App(null, admission)).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(401);
		await request(_App(_User({ issuer: "forged" }), admission)).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(401);
		await request(_App(_User({ authorizationExpiresAt: new Date(0).toISOString() }), admission)).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(401);
		await request(_App(_User(), vi.fn().mockResolvedValue(null))).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(401);
		const warn = vi.fn();
		await request(_App(_User(), vi.fn().mockRejectedValue(new Error("database unavailable")), warn)).get("/protected").set("x-forwarded-host", _EXPECTED_HOST).expect(503);
		expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), siloId: _AUTHORITY.siloId }), "Tier 3 Principal admission is unavailable");
	});
});
