import type { PrismaClient } from "@prisma/client";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreatePersonalArtifactCatalogueRouter } from "../prisma-personal-artifact-catalogue.router";

/** Builds the public route with a deterministic browser session and persistence adapter. */
function _app(principalId: string | null, prisma: PrismaClient): ReturnType<typeof express>
{
	const app = express();
	app.use(function _seedSession(incoming: Request, _response: Response, next: NextFunction): void
	{
		if (principalId === null)
		{
			(incoming as unknown as { session: undefined }).session = undefined;
			next();
			return;
		}
		(incoming as unknown as { session: { authUser: Readonly<Record<string, unknown>> } }).session = {
			authUser: { authenticatedAt: "2026-01-01T00:00:00.000Z" },
		};
		incoming.authenticatedPrincipal = { principalId, siloId: "silo-1", issuer: "https://issuer.test", subject: "subject-1" };
		next();
	});
	app.use("/api/v1/me/assets", _CreatePersonalArtifactCatalogueRouter(prisma, { error: vi.fn() } as unknown as Logger));
	return app;
}

describe("personal artifact catalogue Prisma router", function _suite()
{
	it("derives the exact silo from the host and uses the admitted Principal as owner", async function _derivesCaller()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;

		const response = await request(_app("principal-1", prisma))
			.get("/api/v1/me/assets/")
			.set("x-forwarded-host", "silo-1.dev.opencrane.ai");

		expect(response.status).toBe(200);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", ownerPrincipalId: "principal-1", state: expect.any(Object) }) }));
	});

	it("denies a request without an admitted Principal", async function _deniesMissingPrincipal()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;
		const denied = await request(_app(null, prisma)).get("/api/v1/me/assets/").set("x-forwarded-host", "silo-1.dev.opencrane.ai");
		expect(denied.status).toBe(401);
		expect(findMany).not.toHaveBeenCalled();
	});
});
