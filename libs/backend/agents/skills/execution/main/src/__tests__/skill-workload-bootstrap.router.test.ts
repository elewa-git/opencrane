import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateSkillWorkloadBootstrapRouter } from "../skill-workload-bootstrap.router";
import type { SkillWorkloadBootstrapRouterDependencies } from "../skill-workload-bootstrap.types";

/** Fixed opaque reference used solely by the focused HTTP boundary tests. */
const _REFERENCE = `skill-bootstrap-v1_${"a".repeat(64)}`;

/** Build one Express app with a configurable worker-bootstrap authority. */
function _App(overrides: Partial<SkillWorkloadBootstrapRouterDependencies> = {})
{
	const dependencies: SkillWorkloadBootstrapRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" }) },
		authority: { loadUnconsumedByReferenceHash: vi.fn().mockResolvedValue({ workloadId: "workload-1", referenceHash: `sha256:${"b".repeat(64)}`, audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "opencrane-skill-authoring", workloadUid: "job-uid-1", podUid: "pod-uid-1" }), consumeAtomically: vi.fn().mockResolvedValue("consumed") },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillWorkloadBootstrapRouter(dependencies));
	return { app, dependencies };
}

describe("governed skill worker bootstrap router", function _DescribeBootstrap()
{
	it("consumes one hash-addressed bootstrap only after the exact reviewed Pod identity matches", async function _ConsumesExactIdentity()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-workloads:bootstrap").set("authorization", "Bearer projected-token").send({ bootstrapReference: _REFERENCE });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ acknowledged: true, workloadId: "workload-1" });
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token", "opencrane-skill-authoring");
		expect(dependencies.authority.consumeAtomically).toHaveBeenCalledWith(expect.stringMatching(/^sha256:[a-f0-9]{64}$/), { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" });
	});

	it("does not consume when a reviewed worker Pod differs from durable registration", async function _RejectsForeignPod()
	{
		const authority = { loadUnconsumedByReferenceHash: vi.fn().mockResolvedValue({ workloadId: "workload-1", referenceHash: `sha256:${"b".repeat(64)}`, audience: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", namespace: "opencrane-skill-authoring", workloadUid: "job-uid-1", podUid: "pod-uid-1" }), consumeAtomically: vi.fn() };
		const { app } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "foreign-pod" }) }, authority });

		expect((await request(app).post("/skill-workloads:bootstrap").set("authorization", "Bearer projected-token").send({ bootstrapReference: _REFERENCE })).status).toBe(401);
		expect(authority.consumeAtomically).not.toHaveBeenCalled();
	});

	it("rejects malformed or extended submissions before durable lookup", async function _RejectsCallerPolicy()
	{
		const { app, dependencies } = _App();
		expect((await request(app).post("/skill-workloads:bootstrap").set("authorization", "Bearer projected-token").send({ bootstrapReference: _REFERENCE, namespace: "attacker-chosen" })).status).toBe(401);
		expect(dependencies.authority.loadUnconsumedByReferenceHash).not.toHaveBeenCalled();
	});
});
