import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateAgentRunWorkflowControllerRouter } from "../agent-run-workflow-controller.router";
import type { AgentRunWorkflowControllerRouterDependencies } from "../agent-run-workflow-controller.router.types";

/** Builds the exact task request the remote controller receives from Absurd. */
function _TaskRequest(): { readonly input: { readonly siloId: string; readonly runId: string; readonly attempt: number }; readonly task: { readonly taskId: string; readonly taskName: "agent-runs.execute/v1"; readonly idempotencyKey: string } }
{
	return { input: { siloId: "silo-a", runId: "run-1", attempt: 1 }, task: { taskId: "task-1", taskName: "agent-runs.execute/v1", idempotencyKey: "agent-run:silo-a:run-1:attempt:1" } };
}

/** Creates the authenticated server boundary with a controllable task authority. */
function _Dependencies(): AgentRunWorkflowControllerRouterDependencies
{
	return {
		tokenReviewer: { __Review: vi.fn(async function _Review() { return { username: "system:serviceaccount:silo-a:agent-controller", namespace: "silo-a", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }; }) },
		namespace: "silo-a",
		authority: {
			loadForTask: vi.fn(async function _Load() { return { siloId: "silo-a", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", workloadProfile: "personal-default", namespace: "silo-a-runtime", bootstrapReference: "bootstrap-v1_test", assignmentExpiresAt: "2099-01-01T00:00:00.000Z" }; }),
			mintAttemptKey: vi.fn(),
			revokeAttemptKey: vi.fn(),
			bindAssignment: vi.fn(),
			bindFirstPod: vi.fn(),
			claimRelease: vi.fn(),
			terminalizeFailedTask: vi.fn(),
			observe: vi.fn(),
		},
		logger: { error: vi.fn() },
	};
}

describe("AgentRun workflow controller router", function _Suite()
{
	it("serves only the exact admitted task to the reviewed controller identity", async function _ServesTask()
	{
		const dependencies = _Dependencies();
		const app = express();
		app.use(express.json());
		app.use(__CreateAgentRunWorkflowControllerRouter(dependencies));

		const response = await request(app).post("/agent-run-workflows/load").set("authorization", "Bearer projected-token").send(_TaskRequest());
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ runId: "run-1", workloadProfile: "personal-default" });
		expect(dependencies.authority.loadForTask).toHaveBeenCalledWith(_TaskRequest().input, _TaskRequest().task);
	});

	it("denies an unreviewed controller before it exposes task state", async function _DeniesUnreviewedController()
	{
		const dependencies = _Dependencies();
		(dependencies.tokenReviewer.__Review as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const app = express();
		app.use(express.json());
		app.use(__CreateAgentRunWorkflowControllerRouter(dependencies));

		const response = await request(app).post("/agent-run-workflows/load").set("authorization", "Bearer rejected-token").send(_TaskRequest());
		expect(response.status).toBe(401);
		expect(dependencies.authority.loadForTask).not.toHaveBeenCalled();
	});

	it("records a receipt-fenced terminal setup failure", async function _RecordsTerminalFailure()
	{
		const dependencies = _Dependencies();
		const app = express();
		app.use(express.json());
		app.use(__CreateAgentRunWorkflowControllerRouter(dependencies));

		const response = await request(app).post("/agent-run-workflows/terminal-failure").set("authorization", "Bearer projected-token").send(_TaskRequest());
		expect(response.status).toBe(204);
		expect(dependencies.authority.terminalizeFailedTask).toHaveBeenCalledWith(_TaskRequest().input, _TaskRequest().task);
	});
});
