import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateMcpbValidationControllerRouter } from "../mcpb-validation/mcpb-validation-controller.router";
import type { McpbValidationControllerRouterDependencies } from "../mcpb-validation/mcpb-validation-controller.types";

/** Build an internal controller app with replaceable authority dependencies. */
function _App(overrides: Partial<McpbValidationControllerRouterDependencies> = {})
{
	const dependencies: McpbValidationControllerRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({}) },
		authority: { claimNextAtomically: vi.fn().mockResolvedValue(null), commitAssignmentAtomically: vi.fn().mockResolvedValue("conflict") },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateMcpbValidationControllerRouter(dependencies));
	return { app, dependencies };
}

describe("MCP bundle validation controller router", function _McpbValidationControllerRouterSuite()
{
	it("does not expose workload state without the reviewed controller token", async function _RejectsUnknownCaller()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });

		const response = await request(app).post("/mcpb-validations:claim").set("authorization", "Bearer rejected-token").send({});

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "controller_identity_denied" });
		expect(dependencies.authority.claimNextAtomically).not.toHaveBeenCalled();
	});

	it("returns only the database-fenced claim to the reviewed controller", async function _ReturnsClaim()
	{
		const claim = { workloadId: "workload-1", siloId: "silo-1", validationId: "validation-1", claimedAt: "2026-08-25T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T00:00:30.000Z" };
		const { app } = _App({ authority: { claimNextAtomically: vi.fn().mockResolvedValue(claim), commitAssignmentAtomically: vi.fn() } });

		const response = await request(app).post("/mcpb-validations:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual(claim);
	});

	it("records a bounded Job UID assignment and rejects added caller fields", async function _CommitsAssignment()
	{
		const assignment = { claimedAt: "2026-08-25T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1" };
		const authority = { claimNextAtomically: vi.fn(), commitAssignmentAtomically: vi.fn().mockResolvedValue("assigned") };
		const { app } = _App({ authority });

		const response = await request(app).put("/mcpb-validations/workload-1/assignment").set("authorization", "Bearer projected-token").send(assignment);
		const invalid = await request(app).put("/mcpb-validations/workload-1/assignment").set("authorization", "Bearer projected-token").send({ ...assignment, callerSelected: "untrusted" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-uid-1" });
		expect(authority.commitAssignmentAtomically).toHaveBeenCalledWith("workload-1", assignment);
		expect(invalid.status).toBe(400);
	});
});
