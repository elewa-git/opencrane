import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreateAgentServicesRouter } from "../agent-revision.router";
import type { AgentServicesRouterDependencies } from "../agent-revision.router.types";

/** Builds router dependencies with a caller and an observable catalogue repository port. */
function _dependencies(overrides: Partial<AgentServicesRouterDependencies> = {}): AgentServicesRouterDependencies
{
	return {
		lifecycle: { listManagedServices: vi.fn().mockResolvedValue([]) },
		resolveCaller: function _caller() { return { siloId: "silo-1", principalId: "principal-1", externalSubject: "user-1" }; },
		logger: { error: vi.fn() } as unknown as Logger,
		...overrides,
	} as unknown as AgentServicesRouterDependencies;
}

/** Mounts the router below its public agent-services prefix. */
function _app(dependencies: AgentServicesRouterDependencies)
{
	const app = express();
	app.use("/api/v1/agent-services", __CreateAgentServicesRouter(dependencies));
	return app;
}

describe("managed agent services catalogue router", function _suite()
{
	it("lists only the management catalogue for the session-derived silo", async function _lists()
	{
		const listManagedServices = vi.fn().mockResolvedValue([{ id: "service-1", siloId: "silo-1", kind: "managed", name: "Research", state: "active", activeRevisionId: "revision-1", workloadProfile: "managed", createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T12:00:00.000Z" }]);
		const response = await request(_app(_dependencies({ lifecycle: { listManagedServices } } as unknown as Partial<AgentServicesRouterDependencies>))).get("/api/v1/agent-services/");
		expect(response.status).toBe(200);
		expect(response.body.services).toHaveLength(1);
		expect(listManagedServices).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "principal-1", externalSubject: "user-1" });
	});

	it("requires a signed-in caller before catalogue discovery", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).get("/api/v1/agent-services/");
		expect(response.status).toBe(401);
	});
});
