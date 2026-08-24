import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { LOCAL_DEVELOPMENT_IDENTITY } from "@opencrane/models/local-development";

import { _CreateDevelopmentAuthentication } from "../authentication";

/** Build the exact development middleware order used by the public app. */
function _App()
{
	const app = express();
	const authentication = _CreateDevelopmentAuthentication(LOCAL_DEVELOPMENT_IDENTITY);
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", authentication.router);
	app.use(authentication.productAuthentication);
	app.get("/api/v1/protected", function _Protected(request, response): void
	{
		response.json({ subjectId: request.session.authUser?.sub });
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
	});

	it("ignores caller identity headers and retains the installation-selected subject", async function _IgnoresForgedIdentity(): Promise<void>
	{
		const response = await request(_App())
			.get("/api/v1/protected")
			.set("host", "local-development.localhost:8080")
			.set("x-opencrane-subject", "forged-user")
			.set("x-opencrane-silo", "forged-silo")
			.expect(200);
		expect(response.body).toEqual({ subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId });
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
});
