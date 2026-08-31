import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreatePersonalArtifactCatalogueRouter } from "../personal-artifact-catalogue.router";
import type { PersonalArtifactCatalogueRouterDependencies } from "../personal-artifact-catalogue.router.types";

/** Builds owner-scoped catalogue dependencies for router tests. */
function _dependencies(overrides: Partial<PersonalArtifactCatalogueRouterDependencies> = {}): PersonalArtifactCatalogueRouterDependencies
{
	return { resolveCaller: function _caller() { return { siloId: "silo-1", ownerPrincipalId: "user-1" }; }, catalogue: { listCatalogue: vi.fn().mockResolvedValue([]) }, logger: { error: vi.fn() } as unknown as Logger, ...overrides };
}

/** Mounts the router below its public personal-assets prefix. */
function _app(dependencies: PersonalArtifactCatalogueRouterDependencies)
{
	const app = express();
	app.use("/api/v1/me/assets", __CreatePersonalArtifactCatalogueRouter(dependencies));
	return app;
}

describe("personal asset catalogue router", function _suite()
{
	it("lists only the session-derived owner in the host-derived silo", async function _lists()
	{
		const listCatalogue = vi.fn().mockResolvedValue([{ id: "asset-1" }]);
		const response = await request(_app(_dependencies({ catalogue: { listCatalogue } }))).get("/api/v1/me/assets/");

		expect(response.status).toBe(200);
		expect(response.body.assets).toEqual([{ id: "asset-1" }]);
		expect(listCatalogue).toHaveBeenCalledWith("silo-1", "user-1");
	});

	it("requires an authenticated owner before asset discovery", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).get("/api/v1/me/assets/");
		expect(response.status).toBe(401);
	});

	it("returns a bounded service-unavailable response when catalogue storage fails", async function _handlesFailure()
	{
		const error = new Error("database unavailable");
		const logger = { error: vi.fn() } as unknown as Logger;
		const response = await request(_app(_dependencies({ catalogue: { listCatalogue: vi.fn().mockRejectedValue(error) }, logger }))).get("/api/v1/me/assets/");

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "personal_artifact_catalogue_unavailable" });
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: error, operation: "personal_artifacts.list", siloId: "silo-1" }), "Personal asset catalogue list failed");
	});
});
