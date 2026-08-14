import express from "express";
import request from "supertest";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreateSelfRunCancellationRouter } from "../self-run-cancellation.router";
import { SelfRunCancellationOutcomes, type SelfRunCancellationCommand, type SelfRunCancellationResult } from "../self-run-cancellation.types";

/** Owner-bound cancellation signature used by the route seam. */
type RequestOwned = (command: SelfRunCancellationCommand) => Promise<SelfRunCancellationResult>;

/** Build the self-only cancellation route with session identity and a persistence seam. */
function _app(caller: unknown, requestOwned: Mock<RequestOwned> = vi.fn<RequestOwned>(async function _cancel() { return { outcome: SelfRunCancellationOutcomes.NotFound }; }))
{
	const app = express();
	app.use(express.json());
	app.use(__CreateSelfRunCancellationRouter({ resolveCaller: function _caller() { return caller as never; }, cancellation: { requestOwned }, logger: { error: vi.fn() } as unknown as Logger }));
	return { app, requestOwned };
}

describe("self run cancellation router", function _suite()
{
	it("requests cancellation with session owner and exact observed attempt", async function _cancelsOwnedRun()
	{
		const requestOwned = vi.fn<RequestOwned>(async function _cancel() { return { outcome: SelfRunCancellationOutcomes.Cancelling, runId: "run-1", attempt: 2 }; });
		const response = await request(_app({ siloId: "silo-1", subjectId: "user-1" }, requestOwned).app).post("/run-1/cancellation").send({ expectedAttempt: 2 });
		expect(response.status).toBe(202);
		expect(response.body).toEqual({ runId: "run-1", attempt: 2, state: "cancelling" });
		expect(requestOwned).toHaveBeenCalledWith({ runId: "run-1", expectedAttempt: 2, siloId: "silo-1", subjectId: "user-1" });
	});

	it("returns final cancellation as an idempotent success", async function _returnsCancelled()
	{
		const requestOwned = vi.fn<RequestOwned>(async function _cancel() { return { outcome: SelfRunCancellationOutcomes.Cancelled, runId: "run-1", attempt: 2 }; });
		const response = await request(_app({ siloId: "silo-1", subjectId: "user-1" }, requestOwned).app).post("/run-1/cancellation").send({ expectedAttempt: 2 });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ runId: "run-1", attempt: 2, state: "cancelled" });
	});

	it("does not disclose an absent or foreign run", async function _hidesForeignRun()
	{
		const response = await request(_app({ siloId: "silo-1", subjectId: "user-1" }).app).post("/run-foreign/cancellation").send({ expectedAttempt: 1 });
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "run_not_found" });
	});

	it("rejects stale attempts without changing the request", async function _rejectsStaleAttempt()
	{
		const requestOwned = vi.fn<RequestOwned>(async function _cancel() { return { outcome: SelfRunCancellationOutcomes.AttemptConflict }; });
		const response = await request(_app({ siloId: "silo-1", subjectId: "user-1" }, requestOwned).app).post("/run-1/cancellation").send({ expectedAttempt: 1 });
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "run_attempt_conflict" });
	});

	it("strictly rejects missing, non-integer, and extra body fields", async function _rejectsMalformedBody()
	{
		const { app, requestOwned } = _app({ siloId: "silo-1", subjectId: "user-1" });
		for (const body of [{}, { expectedAttempt: 0 }, { expectedAttempt: 1.5 }, { expectedAttempt: 1, requestedBy: "attacker" }])
		{
			const response = await request(app).post("/run-1/cancellation").send(body);
			expect(response.status).toBe(400);
		}
		expect(requestOwned).not.toHaveBeenCalled();
	});

	it("requires a session-derived caller before invoking cancellation", async function _requiresCaller()
	{
		const { app, requestOwned } = _app(null);
		const response = await request(app).post("/run-1/cancellation").send({ expectedAttempt: 1 });
		expect(response.status).toBe(401);
		expect(requestOwned).not.toHaveBeenCalled();
	});
});
