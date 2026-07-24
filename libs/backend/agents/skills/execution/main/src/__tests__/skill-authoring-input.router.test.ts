import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateSkillAuthoringInputRouter } from "../skill-authoring-input.router.js";
import type { SkillAuthoringInputRouterDependencies } from "../skill-authoring-input.types.js";

/** Immutable artifact record selected by the database fence, never by the worker request. */
const _INPUT = { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 13, mediaType: "application/gzip" };

/** Builds an authoring input route whose security dependencies can be independently denied. */
function _App(overrides: Partial<SkillAuthoringInputRouterDependencies> = {})
{
	const dependencies: SkillAuthoringInputRouterDependencies = {
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" }) },
		repository: { loadForWorker: vi.fn().mockResolvedValue(_INPUT) },
		artifactReader: { read: vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(Buffer.from("skill archive")); controller.close(); } })) },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(__CreateSkillAuthoringInputRouter(dependencies));
	return { app, dependencies };
}

describe("skill authoring input router", function _DescribeAuthoringInput()
{
	it("reviews the fixed audience and streams only the database-selected artifact", async function _ReadsInput()
	{
		const { app, dependencies } = _App();
		const response = await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("application/gzip");
		expect(response.headers["content-length"]).toBe("13");
		expect(response.body.toString()).toBe("skill archive");
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token", "opencrane-skill-authoring");
		expect(dependencies.repository.loadForWorker).toHaveBeenCalledWith("workload-1", { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" });
		expect(dependencies.artifactReader.read).toHaveBeenCalledWith(_INPUT);
	});

	it("denies absent or unreviewed Pod identity before selecting an artifact", async function _RejectsIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue(null) } });
		expect((await request(app).get("/skill-authoring-workloads/workload-1/input")).status).toBe(401);
		expect((await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token")).status).toBe(401);
		expect(dependencies.repository.loadForWorker).not.toHaveBeenCalled();
	});

	it("returns no artifact details when the exact workload and consumed bootstrap fence is unavailable", async function _RejectsStaleWorker()
	{
		const { app, dependencies } = _App({ repository: { loadForWorker: vi.fn().mockResolvedValue(null) } });
		const response = await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "authoring_input_unavailable" });
		expect(dependencies.artifactReader.read).not.toHaveBeenCalled();
	});

	it("fails closed without exposing broker failures or read leases", async function _HidesReaderFailure()
	{
		const { app, dependencies } = _App({ artifactReader: { read: vi.fn().mockRejectedValue(new Error("lease secret must not escape")) } });
		const response = await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(503);
		expect(response.text).not.toContain("lease secret");
		expect(dependencies.logger.error).toHaveBeenCalled();
	});

	it("returns a clean unavailable response when the private stream fails before its first byte", async function _RejectsPreHeaderStreamFailure()
	{
		const broken = new ReadableStream<Uint8Array>({ start(controller): void { controller.error(new Error("lease secret must not escape")); } });
		const { app, dependencies } = _App({ artifactReader: { read: vi.fn().mockResolvedValue(broken) } });
		const response = await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token");

		expect(response.status).toBe(503);
		expect(response.text).not.toContain("lease secret");
		expect(dependencies.logger.error).toHaveBeenCalled();
	});

	it("aborts a half-written response and logs when the private stream fails after its first byte", async function _AbortsMidStreamFailure()
	{
		const broken = new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(Buffer.from("skill archive")); }, pull(controller): void { controller.error(new Error("private connection reset")); } });
		const { app, dependencies } = _App({ artifactReader: { read: vi.fn().mockResolvedValue(broken) } });

		const response = await request(app).get("/skill-authoring-workloads/workload-1/input").set("authorization", "Bearer projected-token");
		expect(response.status).toBe(200);
		await vi.waitFor(function _WaitForStreamFailure(): void { expect(dependencies.logger.error).toHaveBeenCalled(); });
	});
});
