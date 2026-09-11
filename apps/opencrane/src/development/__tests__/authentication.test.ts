import express from "express";
import type { Logger } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipalAdmission } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalCapabilityReader } from "@opencrane/backend/server/iam/identity";

import { _CreateDevelopmentAuthentication } from "../authentication";
import { _DEVELOPMENT_IDENTITY } from "../config";

/** Exact per-launch credential supplied to the focused browser boundary. */
const _BROWSER_CREDENTIAL = "a".repeat(43);

/** Build durable admission for the seeded identity. */
function _Admission(): AuthenticatedPrincipalAdmission
{
	return { admit: vi.fn().mockResolvedValue({ issuer: _DEVELOPMENT_IDENTITY.issuer, principalId: _DEVELOPMENT_IDENTITY.principalId, siloId: _DEVELOPMENT_IDENTITY.siloId, subject: _DEVELOPMENT_IDENTITY.subjectId }) };
}

/** Build the development middleware in listener order. */
function _App(admission: AuthenticatedPrincipalAdmission = _Admission())
{
	const capabilities: AuthenticatedPrincipalCapabilityReader = { canAdministerOrganization: vi.fn().mockResolvedValue(true) };
	const authentication = _CreateDevelopmentAuthentication(_DEVELOPMENT_IDENTITY, capabilities, admission, _BROWSER_CREDENTIAL, { warn: vi.fn() } as unknown as Logger);
	const app = express();
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", authentication.router);
	app.use(authentication.authMiddleware);
	app.get("/api/v1/protected", function _Protected(incoming, response): void
	{
		response.json({ principalId: incoming.authenticatedPrincipal?.principalId });
	});
	app.post("/api/v1/protected", function _Mutating(_incoming, response): void
	{
		response.status(204).end();
	});
	return app;
}

describe("Tier 2 development authentication", function _Suite(): void
{
	it("admits the seeded Principal through durable projection", async function _Admits(): Promise<void>
	{
		const response = await request(_App()).get("/api/v1/protected").set("Host", "local-development.localhost:8080").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(200);
		expect(response.body.principalId).toBe("local-development-principal");
	});

	it("refuses an unexpected host before Principal admission", async function _RejectsHost(): Promise<void>
	{
		const admission = _Admission();
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "localhost:8080");
		expect(response.status).toBe(403);
		expect(admission.admit).not.toHaveBeenCalled();
	});

	it("refuses the seeded Principal without the per-launch browser credential", async function _RejectsMissingCredential(): Promise<void>
	{
		const admission = _Admission();
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "local-development.localhost:8080");
		expect(response.status).toBe(401);
		expect(response.body.code).toBe("DEVELOPMENT_SESSION_REQUIRED");
		expect(admission.admit).not.toHaveBeenCalled();
	});

	it("refuses a state change from another browser origin", async function _RejectsOrigin(): Promise<void>
	{
		const response = await request(_App()).post("/api/v1/protected").set("Host", "local-development.localhost:8080").set("Origin", "http://attacker.localhost:4200").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(403);
		expect(response.body.code).toBe("DEVELOPMENT_ORIGIN_MISMATCH");
	});

	it("accepts the exact Angular proxy host and origin", async function _AcceptsProxy(): Promise<void>
	{
		const response = await request(_App()).post("/api/v1/protected").set("Host", "127.0.0.1:8080").set("X-Forwarded-Host", "local-development.localhost:4200").set("Origin", "http://local-development.localhost:4200").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(204);
	});

	it("fails closed when the durable Principal is absent", async function _RejectsAbsentPrincipal(): Promise<void>
	{
		const admission: AuthenticatedPrincipalAdmission = { admit: vi.fn().mockResolvedValue(null) };
		const response = await request(_App(admission)).get("/api/v1/protected").set("Host", "local-development.localhost:8080").set("X-OpenCrane-Development-Session", _BROWSER_CREDENTIAL);
		expect(response.status).toBe(401);
	});
});
