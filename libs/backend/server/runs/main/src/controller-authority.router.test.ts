import type * as k8s from "@kubernetes/client-node";
import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateControllerAuthorityRouter } from "./controller-authority.router.js";
import type { ControllerAuthorityRepository } from "./controller-authority.types.js";

/** Creates the only controller identity accepted by the internal authority. */
function _authApi(username = "system:serviceaccount:opencrane-system:agent-controller", audience = "agent-controller"): k8s.AuthenticationV1Api
{
	return { createTokenReview: vi.fn().mockResolvedValue({ status: { authenticated: true, audiences: [audience], user: { username } } }) } as unknown as k8s.AuthenticationV1Api;
}

/** Builds a compact server-side controller authority fake. */
function _repository(): ControllerAuthorityRepository
{
	return {
		claimDesiredJob: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectId: "user-1", namespace: "runtime", serviceAccountName: "agent-runtime", image: "ghcr.io/opencrane/runtime@sha256:abc" }),
		recordJob: vi.fn().mockResolvedValue({ bootstrapReady: false }),
		recordPod: vi.fn().mockResolvedValue(undefined),
		rejectDesiredJob: vi.fn().mockResolvedValue(undefined),
	};
}

/** Creates the otherwise separate internal listener for adapter tests. */
function _app(repository: ControllerAuthorityRepository, authApi: k8s.AuthenticationV1Api): Express
{
	const app = express();
	app.use(express.json());
	app.use("/api/internal/agent-controller", __CreateControllerAuthorityRouter({ repository, authApi, identity: { audience: "agent-controller", namespace: "opencrane-system", serviceAccountName: "agent-controller" }, nowEpochMs: function _now() { return 1_000; } }));
	return app;
}

describe("controller authority internal router", function _suite()
{
	it("accepts only the exact audience and service account before returning desired work", async function _desired()
	{
		const repository = _repository();
		const authApi = _authApi();
		const response = await request(_app(repository, authApi)).get("/api/internal/agent-controller/desired").set("Authorization", "Bearer controller-token");

		expect(response.status).toBe(200);
		expect(response.body.desired).toMatchObject({ runId: "run-1", attempt: 1 });
		expect(repository.claimDesiredJob).toHaveBeenCalledWith(1_000);
		expect(authApi.createTokenReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ spec: expect.objectContaining({ audiences: ["agent-controller"], token: "controller-token" }) }) }));
	});

	it("rejects a valid token with another service-account identity or audience", async function _identity()
	{
		const wrongIdentity = await request(_app(_repository(), _authApi("system:serviceaccount:opencrane-system:other"))).get("/api/internal/agent-controller/desired").set("Authorization", "Bearer t");
		const wrongAudience = await request(_app(_repository(), _authApi(undefined, "opencrane"))).get("/api/internal/agent-controller/desired").set("Authorization", "Bearer t");

		expect(wrongIdentity.status).toBe(401);
		expect(wrongAudience.status).toBe(401);
	});

	it("acknowledges only compact durable coordinates and observed Kubernetes UIDs", async function _acknowledges()
	{
		const repository = _repository();
		const app = _app(repository, _authApi());
		const job = await request(app).post("/api/internal/agent-controller/workloads/job").set("Authorization", "Bearer t").send({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1", workloadUid: "job-uid", desired: { image: "attacker/image:latest" } });
		const pod = await request(app).post("/api/internal/agent-controller/workloads/pod").set("Authorization", "Bearer t").send({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1", workloadUid: "job-uid", podUid: "pod-uid" });

		expect(job.status).toBe(200);
		expect(pod.status).toBe(204);
		expect(repository.recordJob).toHaveBeenCalledWith({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1", workloadUid: "job-uid" }, 1_000);
		expect(repository.recordPod).toHaveBeenCalledWith({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1", workloadUid: "job-uid", podUid: "pod-uid" }, 1_000);
	});

	it("does not invoke authority methods for missing tokens or malformed acknowledgement data", async function _rejectsUntrusted()
	{
		const repository = _repository();
		const app = _app(repository, _authApi());
		const missingToken = await request(app).post("/api/internal/agent-controller/workloads/job").send({ runId: "run-1", attempt: 1, workloadName: "job", workloadUid: "uid" });
		const malformed = await request(app).post("/api/internal/agent-controller/workloads/job").set("Authorization", "Bearer t").send({ runId: "run-1", attempt: 0, workloadName: "job", workloadUid: "uid" });

		expect(missingToken.status).toBe(401);
		expect(malformed.status).toBe(400);
		expect(repository.recordJob).not.toHaveBeenCalled();
	});
});
