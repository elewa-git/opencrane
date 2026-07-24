import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateSkillAuthoringCompletionRouter } from "../skill-authoring-completion.router.js";
import type { SkillAuthoringCompletionRouterDependencies } from "../skill-authoring-completion.types.js";

/** A bounded successful authoring report that carries no source, artifact, or credential data. */
const _SUCCESS = { workloadId: "workload-1", outcome: "succeeded", testReport: { passed: true, summary: "all checks passed", checksRun: 2 }, scanResult: { passed: true, summary: "no findings", checksRun: 3 } };

/** Build one Express app with a configurable authoring completion authority. */
function _App(overrides: Partial<SkillAuthoringCompletionRouterDependencies> = {})
{
	const dependencies: SkillAuthoringCompletionRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" }) },
		repository: { completeAtomically: vi.fn().mockResolvedValue("completed") },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillAuthoringCompletionRouter(dependencies));
	return { app, dependencies };
}

describe("skill authoring completion router", function _DescribeAuthoringCompletion()
{
	it("reviews the route-owned authoring audience then forwards only bounded evidence", async function _Completes()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-authoring-workloads:complete").set("authorization", "Bearer projected-token").send(_SUCCESS);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ completed: true });
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token", "opencrane-skill-authoring");
		expect(dependencies.repository.completeAtomically).toHaveBeenCalledWith(_SUCCESS, { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" });
	});

	it("rejects an unauthenticated worker before it can select a workload", async function _RejectsNoToken()
	{
		const { app, dependencies } = _App();
		expect((await request(app).post("/skill-authoring-workloads:complete").send(_SUCCESS)).status).toBe(401);
		expect(dependencies.repository.completeAtomically).not.toHaveBeenCalled();
	});

	it("rejects free-form result fields and failed successful reports", async function _RejectsUnboundedEvidence()
	{
		const { app, dependencies } = _App();
		expect((await request(app).post("/skill-authoring-workloads:complete").set("authorization", "Bearer projected-token").send({ ..._SUCCESS, output: "worker source" })).status).toBe(400);
		expect((await request(app).post("/skill-authoring-workloads:complete").set("authorization", "Bearer projected-token").send({ ..._SUCCESS, testReport: { ..._SUCCESS.testReport, summary: "\u0000" } })).status).toBe(400);
		expect(dependencies.repository.completeAtomically).not.toHaveBeenCalled();
	});

	it("returns conflict when the exact released worker bootstrap cannot terminalise the workload", async function _RejectsStaleWorker()
	{
		const { app } = _App({ repository: { completeAtomically: vi.fn().mockResolvedValue("conflict") } });
		expect((await request(app).post("/skill-authoring-workloads:complete").set("authorization", "Bearer projected-token").send({ workloadId: "workload-1", outcome: "failed", failureCode: "test_process_failed" })).status).toBe(409);
	});
});
