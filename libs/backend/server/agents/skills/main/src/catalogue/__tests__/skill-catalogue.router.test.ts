import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreateSkillCatalogueRouter } from "../skill-catalogue.router";
import type { SkillCatalogueRouterDependencies } from "../skill-catalogue.router.types";

/** Builds router dependencies with a caller and observable silo-bound catalogue port. */
function _dependencies(overrides: Partial<SkillCatalogueRouterDependencies> = {}): SkillCatalogueRouterDependencies
{
	return { resolveCaller: function _caller() { return { siloId: "silo-1", principalId: "principal-1" }; }, catalogue: { listCatalogue: vi.fn().mockResolvedValue([]) }, logger: { error: vi.fn() } as unknown as Logger, ...overrides };
}

/** Mounts the router beneath its public skill catalogue prefix. */
function _app(dependencies: SkillCatalogueRouterDependencies)
{
	const app = express();
	app.use("/api/v1/skills", __CreateSkillCatalogueRouter(dependencies));
	return app;
}

describe("skill catalogue router", function _suite()
{
	it("lists only the session-derived silo catalogue", async function _lists()
	{
		const listCatalogue = vi.fn().mockResolvedValue([{ id: "skill-1" }]);
		const response = await request(_app(_dependencies({ catalogue: { listCatalogue } }))).get("/api/v1/skills/");

		expect(response.status).toBe(200);
		expect(response.body.skills).toEqual([{ id: "skill-1" }]);
		expect(listCatalogue).toHaveBeenCalledWith("silo-1", "principal-1");
	});

	it("requires an authenticated caller before catalogue discovery", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).get("/api/v1/skills/");

		expect(response.status).toBe(401);
	});
});
