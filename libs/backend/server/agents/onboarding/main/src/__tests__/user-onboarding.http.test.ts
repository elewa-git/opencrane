import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/backend/observability";

import { __CreateUserOnboardingRouter } from "../user-onboarding.http.js";
import type { __UserOnboardingAuthority } from "../user-onboarding-authority.js";

describe("__CreateUserOnboardingRouter", function _UserOnboardingRouterSuite()
{
	it("logs an unexpected authority failure with bounded owner context", async function _LogsAuthorityFailure()
	{
		const err = new Error("database unavailable");
		const authority = { readOrCreate: vi.fn().mockRejectedValue(err) } as unknown as __UserOnboardingAuthority;
		const error = vi.fn();
		const logger = { error } as unknown as Logger;
		const app = express();
		app.use("/api/v1/me/onboarding", __CreateUserOnboardingRouter({
			authority,
			resolveOwner: function _Owner() { return { siloId: "silo-a", subjectId: "subject-a" }; },
			logger,
		}));

		const response = await request(app).get("/api/v1/me/onboarding");

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "onboarding_authority_unavailable" });
		expect(error).toHaveBeenCalledWith(
			{ err, operation: "user_onboarding.read_or_create", siloId: "silo-a", subjectId: "subject-a" },
			"User onboarding route-state read failed",
		);
	});

	it("returns an authentication denial without calling or logging the authority", async function _DeniesAnonymous()
	{
		const readOrCreate = vi.fn();
		const error = vi.fn();
		const app = express();
		app.use(__CreateUserOnboardingRouter({
			authority: { readOrCreate } as unknown as __UserOnboardingAuthority,
			resolveOwner: function _Anonymous() { return null; },
			logger: { error } as unknown as Logger,
		}));

		const response = await request(app).get("/");

		expect(response.status).toBe(401);
		expect(readOrCreate).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});
});
