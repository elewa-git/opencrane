import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/observability";

import { __CreatePersonalConfigurationRouter } from "../personal-configuration.router.js";
import type { PersonalConfigurationRouterDependencies } from "../personal-configuration.router.types.js";

/** Build one self-only decision router with observable authority ports. */
function _dependencies(overrides: Partial<PersonalConfigurationRouterDependencies> = {}): PersonalConfigurationRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", userId: "user-1" }; },
		changes: { decideAtomically: vi.fn().mockResolvedValue({ status: "accepted" }) },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		...overrides,
	};
}

/** Mount the router below the public self-only personal-configuration prefix. */
function _app(dependencies: PersonalConfigurationRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/personal-configuration", __CreatePersonalConfigurationRouter(dependencies));
	return app;
}

describe("__CreatePersonalConfigurationRouter", function _describeRouter()
{
	it("requires a session-derived owner before revealing a proposal decision path", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).post("/api/v1/me/personal-configuration/changes/change-1/decision").send({ decision: "accepted" });

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "personal_configuration_authentication_required" });
	});

	it("rejects extra browser coordinates before it calls the owner decision authority", async function _rejectsExtraCoordinates()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/personal-configuration/changes/change-1/decision").send({ decision: "accepted", userId: "forged" });

		expect(response.status).toBe(400);
		expect(dependencies.changes.decideAtomically).not.toHaveBeenCalled();
	});

	it("records a session-owned accept decision with the server timestamp", async function _accepts()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/personal-configuration/changes/change-1/decision").send({ decision: "accepted" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ changeId: "change-1", state: "accepted" });
		expect(dependencies.changes.decideAtomically).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "accepted", rejectionReason: null, decidedAt: "2026-07-26T12:00:00.000Z" });
	});

	it("records a rejected decision with its bounded owner explanation", async function _rejects()
	{
		const dependencies = _dependencies({ changes: { decideAtomically: vi.fn().mockResolvedValue({ status: "rejected" }) } });
		const response = await request(_app(dependencies)).post("/api/v1/me/personal-configuration/changes/change-1/decision").send({ decision: "rejected", rejectionReason: "Keep the current setup." });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ changeId: "change-1", state: "rejected" });
		expect(dependencies.changes.decideAtomically).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "rejected", rejectionReason: "Keep the current setup.", decidedAt: "2026-07-26T12:00:00.000Z" });
	});

	it("does not disclose another owner's proposal when the authority refuses it", async function _hidesOtherOwner()
	{
		const response = await request(_app(_dependencies({ changes: { decideAtomically: vi.fn().mockResolvedValue({ status: "not_found_or_not_owner" }) } }))).post("/api/v1/me/personal-configuration/changes/change-other/decision").send({ decision: "accepted" });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "not_found_or_not_owner" });
	});
});
