import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreatePersonalArtifactCatalogueRouter } from "../personal-artifact-catalogue-wiring.js";

/** Builds the public route with a deterministic browser session and persistence adapter. */
function _app(authUser: Readonly<Record<string, unknown>> | null, prisma: PrismaClient): ReturnType<typeof express>
{
	const app = express();
	app.use(function _seedSession(incoming: Request, _response: Response, next: NextFunction): void
	{
		(incoming as unknown as { session: { authUser: Readonly<Record<string, unknown>> } | undefined }).session = authUser === null ? undefined : { authUser };
		next();
	});
	app.use("/api/v1/me/assets", _CreatePersonalArtifactCatalogueRouter(prisma));
	return app;
}

describe("personal artifact catalogue wiring", function _suite()
{
	it("derives the exact silo from the host and prefers the signed subject as owner", async function _derivesCaller()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;

		const response = await request(_app({ sub: "subject-1", email: "fallback@example.com" }, prisma))
			.get("/api/v1/me/assets/")
			.set("x-forwarded-host", "silo-1.dev.opencrane.ai");

		expect(response.status).toBe(200);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", ownerPrincipalId: "subject-1", state: expect.any(Object) } }));
	});

	it("normalises the signed-in email fallback and denies a missing session", async function _handlesFallback()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;
		const app = _app({ email: "Owner@Example.COM" }, prisma);

		const response = await request(app).get("/api/v1/me/assets/").set("x-forwarded-host", "silo-1.dev.opencrane.ai");
		expect(response.status).toBe(200);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerPrincipalId: "owner@example.com" }) }));

		const denied = await request(_app(null, prisma)).get("/api/v1/me/assets/").set("x-forwarded-host", "silo-1.dev.opencrane.ai");
		expect(denied.status).toBe(401);
	});
});
