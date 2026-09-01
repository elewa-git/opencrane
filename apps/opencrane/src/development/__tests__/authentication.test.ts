import express from "express";
import type { Logger } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";
import { LOCAL_DEVELOPMENT_IDENTITY, LOCAL_DEVELOPMENT_PRINCIPAL_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER } from "@opencrane/models/local-development";

import { _CreateDevelopmentAuthentication } from "../authentication";

/** Build an admission result that matches the identity stored by the Tier 2 seed. */
function _PrincipalAdmission(): AuthenticatedPrincipalAdmission
{
	return {
		admit: vi.fn().mockResolvedValue({
			principalId: LOCAL_DEVELOPMENT_PRINCIPAL_ID,
			siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
		})
	};
}

/** Build the exact development middleware order used by the public app. */
function _App(capabilities: AuthenticatedPrincipalCapabilityReader = { canAdministerOrganization: vi.fn().mockResolvedValue(true) }, admission: AuthenticatedPrincipalAdmission = _PrincipalAdmission())
{
	const app = express();
	const logger = { warn: vi.fn() } as unknown as Logger;
	const authentication = _CreateDevelopmentAuthentication(LOCAL_DEVELOPMENT_IDENTITY, capabilities, admission, logger);
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", authentication.router);
	app.use(authentication.authMiddleware);
	app.get("/api/v1/protected", function _Protected(request, response): void
	{
		response.json({
			subjectId: request.session.authUser?.sub,
			principal: request.authenticatedPrincipal,
			sessionSiloId: request.session.authUser?.siloId,
			authorizationExpiresAt: request.session.authUser?.authorizationExpiresAt
		});
	});
	app.post("/api/v1/protected", function _MutateProtected(_request, response): void
	{
		response.status(204).end();
	});
	return app;
}

describe("Tier 2 browser authentication", function _Suite()
{
	it("returns the fixed seeded identity through the dedicated development-live proxy", async function _ReadsSession(): Promise<void>
	{
		const response = await request(_App())
			.get("/api/v1/auth/me")
			.set("host", "localhost:8080")
			.set("x-forwarded-host", "local-development.localhost:4200")
			.expect(200);
		expect(response.body.authenticated).toBe(true);
		expect(response.body.user.sub).toBe(LOCAL_DEVELOPMENT_IDENTITY.subjectId);
		expect(response.body.user.clusterTenant).toBe(LOCAL_DEVELOPMENT_IDENTITY.siloId);
		expect(response.body.user.productCapabilities).toEqual({ administerOrganization: true });
		expect(response.body.user).not.toHaveProperty("isOrgAdmin");
	});

	it("fails closed when central authorization denies organization administration", async function _DeniesAdministration(): Promise<void>
	{
		const capabilities = { canAdministerOrganization: vi.fn().mockResolvedValue(false) };
		const response = await request(_App(capabilities))
			.get("/api/v1/auth/me")
			.set("host", "local-development.localhost:8080")
			.expect(200);
		expect(capabilities.canAdministerOrganization).toHaveBeenCalledWith({
			siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
		});
		expect(response.body.user.productCapabilities).toEqual({ administerOrganization: false });
	});

	it("does not synthesize an administrator capability when projection fails", async function _RejectsProjectionFailure(): Promise<void>
	{
		await request(_App({ canAdministerOrganization: vi.fn().mockRejectedValue(new Error("authorization unavailable")) }))
			.get("/api/v1/auth/me")
			.set("host", "local-development.localhost:8080")
			.expect(500);
	});

	it("ignores caller identity headers and retains the installation-selected subject", async function _IgnoresForgedIdentity(): Promise<void>
	{
		const admission = _PrincipalAdmission();
		const response = await request(_App(undefined, admission))
			.get("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.set("x-opencrane-subject", "forged-user")
			.set("x-opencrane-silo", "forged-silo")
			.expect(200);
		expect(response.body).toMatchObject({
			subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId,
			sessionSiloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
			principal: {
				principalId: LOCAL_DEVELOPMENT_PRINCIPAL_ID,
				siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
				issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
				subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
			}
		});
		expect(new Date(response.body.authorizationExpiresAt).getTime()).toBeGreaterThan(Date.now());
		expect(admission.admit).toHaveBeenCalledWith({
			siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
			issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
			subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
		});
	});

	it("fails closed when durable Principal and membership-grant projection is unavailable", async function _RejectsUnavailableAdmission(): Promise<void>
	{
		const admission: AuthenticatedPrincipalAdmission = { admit: vi.fn().mockRejectedValue(new Error("database unavailable")) };
		await request(_App(undefined, admission))
			.get("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.expect(503, { error: "identity_projection_unavailable" });
	});

	it("rejects an invalid durable Principal projection", async function _RejectsInvalidAdmission(): Promise<void>
	{
		const admission: AuthenticatedPrincipalAdmission = {
			admit: vi.fn().mockResolvedValue({
				principalId: "",
				siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
				issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
				subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
			})
		};
		await request(_App(undefined, admission))
			.get("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.expect(401, { error: "authenticated_principal_required" });
	});

	it("rejects unexpected direct and forwarded hosts before attaching a session", async function _RejectsHostMismatch(): Promise<void>
	{
		await request(_App())
			.get("/api/v1/auth/me")
			.set("host", "localhost:8080")
			.expect(403);
		await request(_App())
			.get("/api/v1/auth/me")
			.set("host", "localhost:8080")
			.set("x-forwarded-host", "attacker.example.com")
			.expect(403);
	});

	it("rejects cross-origin browser mutations and accepts the exact direct or proxied origin", async function _ChecksMutationOrigin(): Promise<void>
	{
		await request(_App())
			.post("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.set("origin", "https://attacker.example.com")
			.expect(403, { error: "Tier 2 state changes require the dedicated local development origin.", code: "DEVELOPMENT_ORIGIN_MISMATCH" });
		await request(_App())
			.post("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.expect(403, { error: "Tier 2 state changes require the dedicated local development origin.", code: "DEVELOPMENT_ORIGIN_MISMATCH" });
		await request(_App())
			.post("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.set("origin", "http://local-development.localhost:8080")
			.expect(204);
		await request(_App())
			.post("/api/v1/protected")
			.set("host", "localhost:8080")
			.set("x-forwarded-host", "local-development.localhost:4200")
			.set("referer", "http://local-development.localhost:4200/chat")
			.expect(204);
	});
});
