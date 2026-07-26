import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateSkillWorkloadDispatchRouter } from "../skill-workload-dispatch.router.js";
import type { SkillWorkloadDispatchRouterDependencies } from "../skill-workload-dispatch.types.js";

/** Build an Express app with one configurable controller-only skill-workload boundary. */
function _App(overrides: Partial<SkillWorkloadDispatchRouterDependencies> = {})
{
	const dependencies: SkillWorkloadDispatchRouterDependencies = {
		namespace: "silo-a",
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:agent-controller", namespace: "silo-a", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) },
		repository: { claimNextAtomically: vi.fn().mockResolvedValue(null), commitAssignmentAtomically: vi.fn().mockResolvedValue("conflict"), claimNextReleaseAtomically: vi.fn(), commitReleaseAtomically: vi.fn(), registerFirstPodAtomically: vi.fn() },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillWorkloadDispatchRouter(dependencies));
	return { app, dependencies };
}

describe("agent-controller skill-workload dispatch router", function _DescribeRouter()
{
	it("requires the exact reviewed controller identity and audience", async function _RejectsWrongIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:other", namespace: "silo-a", serviceAccountName: "other", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) } });

		const response = await request(app).post("/skill-workloads:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "controller_identity_denied" });
		expect(dependencies.repository.claimNextAtomically).not.toHaveBeenCalled();
	});

	it("returns a bounded failure when Kubernetes TokenReview is unavailable", async function _HandlesTokenReviewFailure()
	{
		const failure = new Error("Kubernetes API unavailable");
		const logger = { error: vi.fn() };
		const { app } = _App({ tokenReviewer: { __Review: vi.fn().mockRejectedValue(failure) }, logger });

		const response = await request(app).post("/skill-workloads:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "skill_workload_authority_unavailable" });
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.skill_workload_claim" }, "Agent-controller skill workload claim failed");
	});

	it("returns an empty normal poll without exposing authority state", async function _ReturnsNoContent()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/skill-workloads:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(204);
		expect(dependencies.repository.claimNextAtomically).toHaveBeenCalledOnce();
	});

	it("returns only the database-fenced workload claim to the reviewed controller", async function _ReturnsClaim()
	{
		const claim = { workloadId: "workload-1", siloId: "silo-a", kind: "authoring" as const, skillRevisionId: "revision-1", claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-24T00:00:30.000Z" };
		const { app } = _App({ repository: { claimNextAtomically: vi.fn().mockResolvedValue(claim), commitAssignmentAtomically: vi.fn(), claimNextReleaseAtomically: vi.fn(), commitReleaseAtomically: vi.fn(), registerFirstPodAtomically: vi.fn() } });

		const response = await request(app).post("/skill-workloads:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual(claim);
	});

	it("forwards exact assignment evidence and rejects caller-selected extensions", async function _CommitsAssignment()
	{
		const command = { claimedAt: "2026-07-24T00:00:00.000Z", deliveryCount: 1, workloadUid: "job-uid-1", bootstrapReference: `skill-bootstrap-v1_${"a".repeat(64)}`, namespace: "tenant-a-authoring" };
		const repository = { claimNextAtomically: vi.fn(), commitAssignmentAtomically: vi.fn().mockResolvedValue("assigned" as const), claimNextReleaseAtomically: vi.fn(), commitReleaseAtomically: vi.fn(), registerFirstPodAtomically: vi.fn() };
		const { app } = _App({ repository });

		const response = await request(app).put("/skill-workloads/workload-1/assignment").set("authorization", "Bearer projected-token").send(command);
		const invalid = await request(app).put("/skill-workloads/workload-1/assignment").set("authorization", "Bearer projected-token").send({ ...command, callerSelectedExtension: "attacker-chosen" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "assigned", workloadId: "workload-1", workloadUid: "job-uid-1" });
		expect(repository.commitAssignmentAtomically).toHaveBeenCalledWith("workload-1", command);
		expect(invalid.status).toBe(400);
	});

	it("logs an unavailable authority without recording the bearer token or body", async function _LogsFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const repository = { claimNextAtomically: vi.fn().mockRejectedValue(failure), commitAssignmentAtomically: vi.fn(), claimNextReleaseAtomically: vi.fn(), commitReleaseAtomically: vi.fn(), registerFirstPodAtomically: vi.fn() };
		const { app } = _App({ repository, logger });

		const response = await request(app).post("/skill-workloads:claim").set("authorization", "Bearer secret-projected-token").send({});

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.skill_workload_claim" }, "Agent-controller skill workload claim failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-projected-token");
	});
});
