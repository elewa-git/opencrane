import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ___AuthMiddleware } from "../auth-middleware";
import type { AuthenticatedPrincipalAdmission } from "../authenticated-principal-admission.types";
import type { AuthUser } from "../session.types";

/** Build one verified session identity accepted by the configured OIDC authority. */
function _AuthUser(overrides: Partial<AuthUser> = {}): AuthUser
{
	return {
		sub: "subject-1",
		issuer: "https://issuer.example",
		groups: ["group:team-1"],
		siloId: "silo-a",
		authorizationExpiresAt: "2099-08-21T10:00:00.000Z",
		isPlatformOperator: false,
		authenticatedAt: "2026-08-21T10:00:00.000Z",
		...overrides,
	};
}

/** Invoke the middleware against one server-owned session fixture without opening a listener. */
async function _Invoke(admission: AuthenticatedPrincipalAdmission, authUser: AuthUser, host = "silo-a.opencrane.test"): Promise<{ readonly request: Request; readonly status: number; readonly body: unknown; readonly admitted: boolean; readonly warn: ReturnType<typeof vi.fn> }>
{
	const incoming = {
		path: "/api/product",
		headers: { host },
		get: function _Get(name: string) { return name.toLowerCase() === "host" ? host : undefined; },
		session: { authUser },
	} as unknown as Request;
	let status = 200;
	let body: unknown;
	let admitted = false;
	const response = {
		status: function _Status(nextStatus: number) { status = nextStatus; return response; },
		json: function _Json(nextBody: unknown) { body = nextBody; return response; },
	} as unknown as Response;
	const next = function _Next() { admitted = true; } as NextFunction;
	const warn = vi.fn();
	await ___AuthMiddleware(admission, { warn } as unknown as Logger)(incoming, response, next);
	return { request: incoming, status, body, admitted, warn };
}

describe("___AuthMiddleware durable Principal admission", function _Suite()
{
	beforeEach(function _ConfigureOidc()
	{
		vi.stubEnv("OIDC_ISSUER_URL", "https://issuer.example");
		vi.stubEnv("OIDC_CLIENT_ID", "opencrane");
		vi.stubEnv("OIDC_REDIRECT_URI", "https://silo-a.opencrane.test/api/v1/auth/callback");
		vi.stubEnv("OIDC_SESSION_SECRET", "test-session-secret");
	});

	afterEach(function _RestoreEnvironment() { vi.unstubAllEnvs(); });

	it("reconciles the exact host silo, issuer, subject, and claims before attaching the Principal", async function _AdmitsExactIdentity()
	{
		const admit = vi.fn().mockResolvedValue({ principalId: "principal-1", siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" });
		const response = await _Invoke({ admit }, _AuthUser({ email: "person@example.test", name: "Person" }));

		expect(response.status).toBe(200);
		expect(response.admitted).toBe(true);
		expect(response.request.authenticatedPrincipal).toEqual({ principalId: "principal-1", siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" });
		expect(admit).toHaveBeenCalledWith({ siloId: "silo-a", issuer: "https://issuer.example", subject: "subject-1" });
	});

	it("denies an issuer, subject, or host that cannot establish the exact admission tuple", async function _RejectsIncompleteTuple()
	{
		const admit = vi.fn();
		const wrongIssuer = await _Invoke({ admit }, _AuthUser({ issuer: "https://other.example" }));
		const missingSubject = await _Invoke({ admit }, _AuthUser({ sub: " " }));
		const missingSilo = await _Invoke({ admit }, _AuthUser(), ".");

		expect([wrongIssuer.status, missingSubject.status, missingSilo.status]).toEqual([401, 401, 401]);
		expect(admit).not.toHaveBeenCalled();
	});

	it("denies a session bound to another silo or past its token expiry", async function _RejectsStaleAuthorization()
	{
		const admit = vi.fn();
		const wrongSilo = await _Invoke({ admit }, _AuthUser({ siloId: "silo-b" }));
		const expired = await _Invoke({ admit }, _AuthUser({ authorizationExpiresAt: "2026-08-20T10:00:00.000Z" }));

		expect([wrongSilo.status, expired.status]).toEqual([401, 401]);
		expect(admit).not.toHaveBeenCalled();
	});

	it("denies stale projection output instead of admitting a mismatched Principal", async function _RejectsStaleProjection()
	{
		const projections = [
			{ principalId: "principal-1", siloId: "other-silo", issuer: "https://issuer.example", subject: "subject-1" },
			{ principalId: "principal-1", siloId: "silo-a", issuer: "https://other.example", subject: "subject-1" },
			{ principalId: "principal-1", siloId: "silo-a", issuer: "https://issuer.example", subject: "other-subject" },
		];
		const responses = [];
		for (const projection of projections) responses.push(await _Invoke({ admit: vi.fn().mockResolvedValue(projection) }, _AuthUser()));

		expect(responses.map(function _Status(response) { return response.status; })).toEqual([401, 401, 401]);
		expect(responses.map(function _Body(response) { return response.body; })).toEqual([
			{ error: "authenticated_principal_required" },
			{ error: "authenticated_principal_required" },
			{ error: "authenticated_principal_required" },
		]);
	});

	it("returns unavailable and never enters the product route when claim projection fails", async function _RejectsProjectionFailure()
	{
		const admit = vi.fn().mockRejectedValue(new Error("database unavailable"));
		const response = await _Invoke({ admit }, _AuthUser());

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "identity_projection_unavailable" });
		expect(response.warn).toHaveBeenCalledWith({ err: expect.any(Error), siloId: "silo-a" }, "OIDC Principal admission is unavailable");
	});
});
