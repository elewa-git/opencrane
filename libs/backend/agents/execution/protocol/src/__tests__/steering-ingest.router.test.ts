import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/observability";

import { __CreateSteeringIngestRouter } from "../steering-ingest.router.js";
import type { SteeringIngestRouterDependencies } from "../steering-ingest.router.types.js";

/** Build one owner-authenticated router with observable steering persistence. */
function _dependencies(overrides: Partial<SteeringIngestRouterDependencies> = {}): SteeringIngestRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", subjectId: "user-1" }; },
		requests: { submitAtomically: vi.fn().mockResolvedValue({ outcome: "queued", steeringRequestId: "steer-1", attempt: 2 }) },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		...overrides,
	};
}

/** Mount the route below the public self-run prefix. */
function _app(dependencies: SteeringIngestRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/runs", __CreateSteeringIngestRouter(dependencies));
	return app;
}

describe("__CreateSteeringIngestRouter", function _suite()
{
	it("requires session-derived ownership before queueing steering", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).post("/api/v1/me/runs/run-1/steering").send({ text: "Focus on the risks." });
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "steering_authentication_required" });
	});

	it("queues only the accepted text and server-derived owner coordinates", async function _queues()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/runs/run-1/steering").send({ text: "  Focus on the risks.  " });
		expect(response.status).toBe(202);
		expect(response.body).toEqual({ steeringRequestId: "steer-1", attempt: 2, state: "pending" });
		expect(dependencies.requests.submitAtomically).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", siloId: "silo-1", subjectId: "user-1", content: { text: "Focus on the risks." }, digest: expect.stringMatching(/^sha256:/) }));
	});

	it("rejects a body that tries to add caller-controlled runtime coordinates", async function _rejectsCoordinates()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/runs/run-1/steering").send({ text: "Focus.", attempt: 99 });
		expect(response.status).toBe(400);
		expect(dependencies.requests.submitAtomically).not.toHaveBeenCalled();
	});

	it("does not disclose an absent or non-owned run", async function _hidesRun()
	{
		const response = await request(_app(_dependencies({ requests: { submitAtomically: vi.fn().mockResolvedValue({ outcome: "not_found_or_not_owner" }) } }))).post("/api/v1/me/runs/run-1/steering").send({ text: "Focus." });
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "run_not_found" });
	});

	it("refuses steering after the attempt's sole resume command is already minted", async function _refusesSecondResume()
	{
		const response = await request(_app(_dependencies({ requests: { submitAtomically: vi.fn().mockResolvedValue({ outcome: "run_not_steerable" }) } }))).post("/api/v1/me/runs/run-1/steering").send({ text: "Focus." });
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "run_not_steerable" });
	});
});
