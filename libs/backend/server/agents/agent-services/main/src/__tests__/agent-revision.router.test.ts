import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateAgentServicesRouter } from "../agent-revision.router.js";
import type { AgentServicesRouterDependencies } from "../agent-revision.router.types.js";

/** Builds the management API with dependencies that must remain untouched for invalid input. */
function _app(): express.Express
{
	const dependencies = {
		lifecycle: { createManagedService: vi.fn() },
		publicationFor: vi.fn(),
		runAdmission: { admitManagedRun: vi.fn() },
		schedules: {},
		scopeGrantResolver: {},
		resolveCaller: vi.fn().mockReturnValue({ subjectId: "admin-1", siloId: "silo-1", isOrgAdmin: true }),
		clock: { now: vi.fn().mockReturnValue(new Date("2026-07-25T00:00:00.000Z")) },
		logger: { error: vi.fn() },
	} as unknown as AgentServicesRouterDependencies;
	const app = express();
	app.use(express.json());
	app.use("/", __CreateAgentServicesRouter(dependencies));
	return app;
}

describe("managed agent revision router", function _suite()
{
	it("rejects a null capability ceiling entry as a validation error", async function _nullCapability()
	{
		const response = await request(_app()).post("/").send({ name: "Reporter", workloadProfile: "managed-default", changeMessage: "initial", content: { promptPolicyVersion: "prompt-v1", modelDefinitionId: "model-1", budget: { maxTurns: 1, maxTokens: 1, maxDurationMs: 1 }, capabilityCeiling: [null] } });
		expect(response.status).toBe(400);
		expect(response.body.code).toBe("VALIDATION_ERROR");
	});
});
