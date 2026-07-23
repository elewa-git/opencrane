import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateAgentControllerRunDispatchRouter } from "../run-dispatch.router.js";
import type { AgentControllerRunDispatchRouterDependencies } from "../run-dispatch.types.js";

/** Creates an Express app with one configurable controller-dispatch boundary. */
function _App(overrides: Partial<AgentControllerRunDispatchRouterDependencies> = {})
{
	const dependencies: AgentControllerRunDispatchRouterDependencies = {
		namespace: "silo-a",
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:agent-controller", namespace: "silo-a", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) },
		repository: { claimNextAttemptAtomically: vi.fn().mockResolvedValue({ status: "none" }), commitSuspendedJobAssignmentAtomically: vi.fn().mockResolvedValue({ status: "conflict", reason: "stale_claim" }), claimNextWorkloadReleaseAtomically: vi.fn().mockResolvedValue({ status: "none" }), registerFirstPodAndPublishReleaseAtomically: vi.fn().mockResolvedValue({ status: "conflict", reason: "stale_claim" }), prunePublishedOutboxEventsAtomically: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
		logger: { error: vi.fn(), warn: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateAgentControllerRunDispatchRouter(dependencies));
	return { app, dependencies };
}

describe("agent-controller run-dispatch router", function _DescribeRouter()
{
	it("requires the exact reviewed controller identity and audience", async function _RejectWrongIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:other", namespace: "silo-a", serviceAccountName: "other", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) } });

		const response = await request(app).post("/run-attempts:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "controller_identity_denied" });
		expect(dependencies.repository.claimNextAttemptAtomically).not.toHaveBeenCalled();
	});

	it("returns an empty normal poll without exposing authority state", async function _ReturnNoContent()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/run-attempts:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(204);
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
		expect(dependencies.repository.claimNextAttemptAtomically).toHaveBeenCalledOnce();
	});

	it("permits bounded delivered-outbox retention only for the reviewed controller", async function _PruneOutbox()
	{
		const { app, dependencies } = _App({ repository: { claimNextAttemptAtomically: vi.fn(), commitSuspendedJobAssignmentAtomically: vi.fn(), claimNextWorkloadReleaseAtomically: vi.fn(), registerFirstPodAndPublishReleaseAtomically: vi.fn(), prunePublishedOutboxEventsAtomically: vi.fn().mockResolvedValue({ deletedCount: 3 }) } });

		const response = await request(app).post("/run-outbox:prune").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ deletedCount: 3 });
		expect(dependencies.repository.prunePublishedOutboxEventsAtomically).toHaveBeenCalledOnce();
	});

	it("forwards exact assignment evidence and maps a stale claim to conflict", async function _CommitConflict()
	{
		const { app, dependencies } = _App();
		const command = { runId: "run-1", attempt: 1, claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expectedWorkloadProfile: "personal-small", bootstrapReference: `bootstrap-v1_${"a".repeat(64)}`, namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1" };

		const response = await request(app).put("/run-attempts/event-1/assignment").set("authorization", "Bearer projected-token").send(command);

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "stale_claim" });
		expect(dependencies.repository.commitSuspendedJobAssignmentAtomically).toHaveBeenCalledWith("event-1", command);
	});

	it("logs a structured operation and never logs the token or body when authority fails", async function _LogFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn(), warn: vi.fn() };
		const repository = { claimNextAttemptAtomically: vi.fn().mockRejectedValue(failure), commitSuspendedJobAssignmentAtomically: vi.fn(), claimNextWorkloadReleaseAtomically: vi.fn(), registerFirstPodAndPublishReleaseAtomically: vi.fn(), prunePublishedOutboxEventsAtomically: vi.fn() };
		const { app } = _App({ repository, logger });

		const response = await request(app).post("/run-attempts:claim").set("authorization", "Bearer secret-projected-token").send({});

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.claim" }, "Agent-controller claim failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-projected-token");
	});

	it("claims release work only for the reviewed controller", async function _ClaimRelease()
	{
		const claim = { lease: { eventId: "release-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:00:30.000Z" }, workload: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1", workloadProfile: "personal-small", assignmentExpiresAt: "2026-07-20T01:00:10.000Z", bootstrapReference: `bootstrap-v1_${"a".repeat(64)}` } } as const;
		const { app, dependencies } = _App({ repository: { claimNextAttemptAtomically: vi.fn(), commitSuspendedJobAssignmentAtomically: vi.fn(), claimNextWorkloadReleaseAtomically: vi.fn().mockResolvedValue({ status: "claimed", claim }), registerFirstPodAndPublishReleaseAtomically: vi.fn(), prunePublishedOutboxEventsAtomically: vi.fn() } });

		const response = await request(app).post("/workload-releases:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual(claim);
		expect(dependencies.repository.claimNextWorkloadReleaseAtomically).toHaveBeenCalledOnce();
	});

	it("warns once after a poisoned release is durably terminalized while preserving empty-poll semantics", async function _LogTerminalizedRelease()
	{
		const terminalized = { status: "terminalized", eventId: "release-1", runId: "run-1", attempt: 1, failureCode: "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID" } as const;
		const logger = { error: vi.fn(), warn: vi.fn() };
		const repository = { claimNextAttemptAtomically: vi.fn(), commitSuspendedJobAssignmentAtomically: vi.fn(), claimNextWorkloadReleaseAtomically: vi.fn().mockResolvedValue(terminalized), registerFirstPodAndPublishReleaseAtomically: vi.fn(), prunePublishedOutboxEventsAtomically: vi.fn() };
		const { app } = _App({ repository, logger });

		const response = await request(app).post("/workload-releases:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(204);
		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith({ eventId: "release-1", runId: "run-1", attempt: 1, failureCode: "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID" }, "Poisoned workload release terminalized after durable repair");
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("bootstrap");
	});

	it("forwards exact first-Pod evidence and rejects extra self-asserted fields", async function _RegisterPod()
	{
		const command = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1", workloadProfile: "personal-small", bootstrapReference: `bootstrap-v1_${"a".repeat(64)}`, podUid: "pod-uid-1" };
		const { app, dependencies } = _App();

		const response = await request(app).put("/workload-releases/release-1/registration").set("authorization", "Bearer projected-token").send(command);
		const invalid = await request(app).put("/workload-releases/release-1/registration").set("authorization", "Bearer projected-token").send({ ...command, trustedByCaller: true });

		expect(response.status).toBe(409);
		expect(dependencies.repository.registerFirstPodAndPublishReleaseAtomically).toHaveBeenCalledWith("release-1", command);
		expect(invalid.status).toBe(400);
	});
});
