import express from "express";
import request from "supertest";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { Logger } from "@opencrane/observability";

import { __CreateSelfRunStatusRouter } from "../self-run-status.router.js";
import type { SelfRunStatus } from "../self-run-status.router.types.js";

/** Read signature exposed by the owner-bound run-status repository. */
type ReadOwned = (runId: string, siloId: string, subjectId: string) => Promise<SelfRunStatus | null>;
/** List signature exposed by the owner-bound run-status repository. */
type ListOwned = (siloId: string, subjectId: string) => Promise<readonly SelfRunStatus[]>;

/** Build the self-only run route with session identity and persistence seams. */
function _app(caller: unknown, readOwned: Mock<ReadOwned> = vi.fn<ReadOwned>(async function _read() { return null; }), listOwned: Mock<ListOwned> = vi.fn<ListOwned>(async function _list() { return []; }))
{
	const app = express();
	app.use(__CreateSelfRunStatusRouter({ resolveCaller: function _caller() { return caller as never; }, repository: { listOwned, readOwned }, logger: { error: vi.fn() } as unknown as Logger }));
	return { app, listOwned, readOwned };
}

describe("self run status router", function _suite()
{
	it("reads only with session-derived owner coordinates", async function _readsOwnedRun()
	{
		const status = { runId: "run-1", attempt: 2, state: "running", threadId: "thread-1", agentRevisionId: "revision-1", acceptedAt: "2026-07-26T12:00:00.000Z", finishedAt: null };
		const { app, readOwned } = _app({ siloId: "silo-1", subjectId: "user-1" }, vi.fn(async function _read() { return status; }));
		const response = await request(app).get("/run-1");
		expect(response.status).toBe(200);
		expect(response.body).toEqual(status);
		expect(readOwned).toHaveBeenCalledWith("run-1", "silo-1", "user-1");
	});

	it("lists only the caller's recent runs through the owner-bound repository", async function _listsOwnedRuns()
	{
		const status = { runId: "run-1", attempt: 2, state: "running", threadId: "thread-1", agentRevisionId: "revision-1", acceptedAt: "2026-07-26T12:00:00.000Z", finishedAt: null };
		const { app, listOwned } = _app({ siloId: "silo-1", subjectId: "user-1" }, undefined, vi.fn(async function _list() { return [status]; }));
		const response = await request(app).get("/");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ runs: [status] });
		expect(listOwned).toHaveBeenCalledWith("silo-1", "user-1");
	});

	it("does not disclose absent or another owner's run", async function _hidesForeignRun()
	{
		const { app } = _app({ siloId: "silo-1", subjectId: "user-1" });
		const response = await request(app).get("/run-foreign");
		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "run_not_found" });
	});

	it("requires a session-derived caller", async function _requiresCaller()
	{
		const response = await request(_app(null).app).get("/run-1");
		expect(response.status).toBe(401);
	});

	it("requires a session-derived caller before listing runs", async function _requiresCallerToList()
	{
		const response = await request(_app(null).app).get("/");
		expect(response.status).toBe(401);
	});
});
