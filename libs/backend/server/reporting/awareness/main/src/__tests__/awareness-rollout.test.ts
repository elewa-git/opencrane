import type { PrismaClient } from "@prisma/client";
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { awarenessRolloutRouter } from "../routes/awareness-rollout.js";

/**
 * Build a Prisma stub backing the singleton rollout with an in-memory row, plus
 * a tenant lookup. `upsert` writes the row so promote/rollback round-trip.
 */
function _buildPrisma(initialRow: Record<string, unknown> | null, tenant?: Record<string, unknown> | null)
{
	const store: { row: Record<string, unknown> | null } = { row: initialRow };
	const prisma = {
		awarenessRollout: {
			findUnique: vi.fn().mockImplementation(function _find() { return Promise.resolve(store.row); }),
			upsert: vi.fn().mockImplementation(function _upsert(args: { create: Record<string, unknown>; update: Record<string, unknown> })
			{
				store.row = { id: "default", ...(store.row ?? {}), ...args.update, ...(store.row ? {} : args.create) };
				return Promise.resolve(store.row);
			}),
		},
		tenant: { findUnique: vi.fn().mockResolvedValue(tenant ?? null) },
	} as unknown as PrismaClient;
	return { prisma, store };
}

function _app(prisma: PrismaClient): Express
{
	const app = express();
	app.use(express.json());
	app.use("/awareness/rollout", awarenessRolloutRouter(prisma));
	return app;
}

describe("awareness rollout router (P4B.3)", function _suite()
{
	it("GET returns a default state when no rollout is defined", async function _getDefault()
	{
		const { prisma } = _buildPrisma(null);
		const res = await request(_app(prisma)).get("/awareness/rollout");
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ promotedWaves: [], nextWave: "personal" });
		expect(res.body.waves).toEqual(["personal", "project", "department", "org"]);
	});

	it("PUT defines a rollout (frontier reset) and 400s without targetVersion", async function _set()
	{
		const { prisma } = _buildPrisma(null);
		const app = _app(prisma);

		const bad = await request(app).put("/awareness/rollout").send({ stableVersion: "x" });
		expect(bad.status).toBe(400);

		const ok = await request(app).put("/awareness/rollout").send({ targetVersion: "awareness/v2alpha1", stableVersion: "awareness/v1alpha1" });
		expect(ok.status).toBe(200);
		expect(ok.body).toMatchObject({ targetVersion: "awareness/v2alpha1", promotedWaves: [], nextWave: "personal" });
	});

	it("promote advances the frontier and resolve reflects it; rollback resets", async function _flow()
	{
		const { prisma } = _buildPrisma({
			id: "default", targetVersion: "awareness/v2alpha1", stableVersion: "awareness/v1alpha1",
			waves: ["personal", "project", "department", "org"], promotedWaves: [], shadowMode: false,
		}, { name: "t1", awarenessWave: "personal" });
		const app = _app(prisma);

		const promoted = await request(app).post("/awareness/rollout/promote").send({});
		expect(promoted.body).toMatchObject({ promotedWaves: ["personal"], nextWave: "project" });

		// t1 is in the promoted "personal" wave → resolves to the target.
		const resolved = await request(app).get("/awareness/rollout/resolve/t1");
		expect(resolved.body).toMatchObject({ tenant: "t1", version: "awareness/v2alpha1", promoted: true, wave: "personal" });

		const rolledBack = await request(app).post("/awareness/rollout/rollback");
		expect(rolledBack.body.promotedWaves).toEqual([]);
		const afterRollback = await request(app).get("/awareness/rollout/resolve/t1");
		expect(afterRollback.body).toMatchObject({ version: "awareness/v1alpha1", promoted: false });
	});

	it("promote to an unknown wave 400s; resolve for a missing tenant 404s", async function _errors()
	{
		const { prisma } = _buildPrisma({
			id: "default", targetVersion: "awareness/v2alpha1", stableVersion: "awareness/v1alpha1",
			waves: ["personal", "org"], promotedWaves: [], shadowMode: false,
		}, null);
		const app = _app(prisma);

		const bad = await request(app).post("/awareness/rollout/promote").send({ wave: "nope" });
		expect(bad.status).toBe(400);

		const missing = await request(app).get("/awareness/rollout/resolve/ghost");
		expect(missing.status).toBe(404);
	});
});
