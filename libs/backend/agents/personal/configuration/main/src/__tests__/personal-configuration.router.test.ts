import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/observability";

import { __CreatePersonalConfigurationRouter } from "../personal-configuration.router.js";
import type { PersonalConfigurationChangeView } from "../personal-configuration.types.js";

/** Builds the owner-only proposal route with a caller and observable read port. */
function _app(caller: unknown, listOwned = vi.fn(async function _list(): Promise<readonly PersonalConfigurationChangeView[]> { return []; }))
{
	const app = express();
	const decideAtomically = vi.fn(async function _decide() { return { status: "accepted" } as const; });
	app.use(express.json());
	app.use(__CreatePersonalConfigurationRouter({ resolveCaller: function _caller() { return caller as never; }, changes: { listOwned }, decisions: { decideAtomically }, clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } }, logger: { error: vi.fn() } as unknown as Logger }));
	return { app, decideAtomically, listOwned };
}

describe("personal configuration router", function _suite()
{
	it("lists only proposal state read through the session-derived owner", async function _lists()
	{
		const { app, listOwned } = _app({ siloId: "silo-1", userId: "user-1" }, vi.fn(async function _list() { return [{ changeId: "change-1", requestedPatch: { kind: "persona_refresh" }, state: "proposed", sourceThreadId: "thread-1", sourceRunId: "run-1", proposedAt: "2026-07-26T12:00:00.000Z", decidedAt: null, rejectionReason: null }]; }));
		const response = await request(app).get("/changes");
		expect(response.status).toBe(200);
		expect(response.body.changes).toHaveLength(1);
		expect(listOwned).toHaveBeenCalledWith("silo-1", "user-1");
	});

	it("requires an authenticated owner", async function _requiresCaller()
	{
		const response = await request(_app(null).app).get("/changes");
		expect(response.status).toBe(401);
	});

	it("decides using only the session-derived owner and trusted server time", async function _decides()
	{
		const { app, decideAtomically } = _app({ siloId: "silo-1", userId: "user-1" });
		const response = await request(app).post("/changes/change-1/decision").send({ decision: "accepted" });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ changeId: "change-1", state: "accepted" });
		expect(decideAtomically).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "accepted", rejectionReason: null, decidedAt: "2026-07-26T12:00:00.000Z" });
	});
});
