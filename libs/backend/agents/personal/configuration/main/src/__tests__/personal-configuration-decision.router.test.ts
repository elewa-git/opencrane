import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreatePersonalConfigurationDecisionRouter } from "../personal-configuration-decision.router.js";
import type { PersonalConfigurationDecisionRouterDependencies } from "../personal-configuration-decision.router.types.js";

/** Build a small Express app with a spyable personal configuration decision authority. */
function _App(overrides: Partial<PersonalConfigurationDecisionRouterDependencies> = {})
{
	const dependencies: PersonalConfigurationDecisionRouterDependencies = {
		resolveCaller: vi.fn().mockResolvedValue({ userId: "oidc-subject", siloId: "silo-1" }),
		decisions: { decideAtomically: vi.fn().mockResolvedValue({ status: "accepted" }) },
		clock: { now: function _Now(): Date { return new Date("2026-07-24T12:00:00.000Z"); } },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreatePersonalConfigurationDecisionRouter(dependencies));
	return { app, dependencies };
}

describe("personal configuration decision router", function _DescribePersonalConfigurationDecisionRouter()
{
	it("records an accepted decision with server-derived owner, silo, and timestamp", async function _Accepts()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "accepted" });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ decision: "accepted" });
		expect(dependencies.decisions.decideAtomically).toHaveBeenCalledWith({ siloId: "silo-1", userId: "oidc-subject", changeId: "change-1", decision: "accepted", rejectionReason: null, decidedAt: "2026-07-24T12:00:00.000Z" });
	});

	it("requires a bounded reason when rejecting a proposal", async function _Rejects()
	{
		const { app, dependencies } = _App({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ status: "rejected" }) } });
		const response = await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "rejected", rejectionReason: "I prefer the current model." });
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ decision: "rejected" });
		expect(dependencies.decisions.decideAtomically).toHaveBeenCalledWith(expect.objectContaining({ decision: "rejected", rejectionReason: "I prefer the current model." }));
	});

	it("rejects browser-supplied authority coordinates and incomplete rejection input", async function _RejectsExtraAuthority()
	{
		const { app, dependencies } = _App();
		expect((await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "accepted", userId: "other" })).status).toBe(400);
		expect((await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "rejected" })).status).toBe(400);
		expect(dependencies.decisions.decideAtomically).not.toHaveBeenCalled();
	});

	it("fails closed before deciding when there is no active owner membership", async function _DeniesMissingCaller()
	{
		const { app, dependencies } = _App({ resolveCaller: vi.fn().mockResolvedValue(null) });
		const response = await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "accepted" });
		expect(response.status).toBe(401);
		expect(dependencies.decisions.decideAtomically).not.toHaveBeenCalled();
	});

	it("hides a foreign or missing record behind one not-found result", async function _HidesForeignChange()
	{
		const { app } = _App({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ status: "not_found_or_not_owner" }) } });
		const response = await request(app).post("/personal-configuration-changes/foreign-change/decision").send({ decision: "accepted" });
		expect(response.status).toBe(404);
		expect(response.body.code).toBe("personal_configuration_not_found_or_not_owner");
	});

	it("reports a previously decided proposal as a conflict", async function _RejectsDuplicateDecision()
	{
		const { app } = _App({ decisions: { decideAtomically: vi.fn().mockResolvedValue({ status: "already_decided" }) } });
		expect((await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "accepted" })).status).toBe(409);
	});

	it("reports a membership authority failure separately and logs structured error metadata", async function _ReportsMembershipFailure()
	{
		const { app, dependencies } = _App({ resolveCaller: vi.fn().mockRejectedValue(new Error("membership unavailable")) });
		const response = await request(app).post("/personal-configuration-changes/change-1/decision").send({ decision: "accepted" });
		expect(response.status).toBe(503);
		expect(response.body.code).toBe("personal_configuration_membership_unavailable");
		expect(dependencies.logger.error).toHaveBeenCalledWith(expect.objectContaining({ operation: "personal_configuration.resolve_caller" }), expect.any(String));
	});
});
