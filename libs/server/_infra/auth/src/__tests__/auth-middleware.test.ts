import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";

import { ___AuthMiddleware } from "../auth-middleware.js";

/** OIDC configuration keys restored after each auth middleware test. */
const _OIDC_ENV = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_REDIRECT_URI", "OIDC_SESSION_SECRET"] as const;

/** Enable a minimal complete OIDC configuration so missing sessions must fail closed. */
function _EnableOidc(): Record<string, string | undefined>
{
	const prior: Record<string, string | undefined> = {};
	for (const key of _OIDC_ENV) prior[key] = process.env[key];
	process.env.OIDC_ISSUER_URL = "https://issuer.example.test";
	process.env.OIDC_CLIENT_ID = "opencrane";
	process.env.OIDC_REDIRECT_URI = "https://opencrane.example.test/auth/callback";
	process.env.OIDC_SESSION_SECRET = "test-session-secret";
	return prior;
}

/** Restore the environment state captured before a middleware test. */
function _RestoreOidc(prior: Record<string, string | undefined>): void
{
	for (const key of _OIDC_ENV)
	{
		if (prior[key] === undefined) delete process.env[key];
		else process.env[key] = prior[key];
	}
}

describe("auth middleware", function _DescribeAuthMiddleware()
{
	afterEach(function _ClearEnvironment(): void
	{
		for (const key of _OIDC_ENV) delete process.env[key];
	});

	it("returns the documented shared error envelope when OIDC is enabled but a session is absent", function _ReturnsErrorEnvelope()
	{
		const prior = _EnableOidc();
		const result: { status?: number; body?: unknown; nexted: boolean } = { nexted: false };
		const request = { path: "/api/v1/personal-configuration-changes/change-1/decision" } as Request;
		const response = { status: function _Status(status: number) { result.status = status; return this; }, json: function _Json(body: unknown) { result.body = body; return this; } } as unknown as Response;
		const next: NextFunction = function _Next(): void { result.nexted = true; };
		___AuthMiddleware()(request, response, next);
		expect(result).toEqual({ status: 401, body: { error: "OIDC session required", code: "authentication_required" }, nexted: false });
		_RestoreOidc(prior);
	});
});
