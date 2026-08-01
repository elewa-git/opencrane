import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import type { RateLimitOptions } from "@opencrane/server/_infra/http";
import { _CreateRateLimitedSharesRouter } from "../app/routes.js";

/** Builds the application-owned shares composition without bypassing its HTTP abuse boundary. */
function _app(rateLimit: RateLimitOptions): express.Express
{
	const app = express();
	app.set("trust proxy", 1);
	app.use(express.json());
	app.use("/api/v1/shares", _CreateRateLimitedSharesRouter({} as PrismaClient, { rateLimit }));
	return app;
}

describe("_CreateRateLimitedSharesRouter", function _suite()
{
	it("returns 429 before a repeat reaches the unauthenticated shares handler", async function _limits()
	{
		const app = _app({ max: 1, windowMs: 1_000 });
		expect((await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.10")).status).toBe(401);

		const blocked = await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.10");
		expect(blocked.status).toBe(429);
		expect(blocked.headers["ratelimit-limit"]).toBe("1");
	});

	it("isolates forwarded clients and resets a client budget after its bounded window", async function _isolatesAndResets()
	{
		const app = _app({ max: 1, windowMs: 100 });
		expect((await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.11")).status).toBe(401);
		expect((await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.11")).status).toBe(429);
		expect((await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.12")).status).toBe(401);

		await new Promise<void>(function _waitForWindow(resolve) { setTimeout(resolve, 125); });

		expect((await request(app).get("/api/v1/shares").set("X-Forwarded-For", "203.0.113.11")).status).toBe(401);
	});
});
