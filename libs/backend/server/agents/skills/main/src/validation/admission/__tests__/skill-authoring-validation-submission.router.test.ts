import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { SkillAuthoringValidationAdmissionError } from "@opencrane/backend/agents/skills/workflows";

import { __CreateSkillAuthoringValidationSubmissionRouter } from "../skill-authoring-validation-submission.router";
import { SkillAuthoringValidationSubmissionForbiddenError } from "../skill-authoring-validation-submission.types";
import type { SkillAuthoringValidationSubmissionRouterDependencies } from "../skill-authoring-validation-submission.types";

/** Build a public Express app with a configurable validation submission authority. */
function _App(overrides: Partial<SkillAuthoringValidationSubmissionRouterDependencies> = {})
{
	const dependencies: SkillAuthoringValidationSubmissionRouterDependencies = {
		resolveCaller: vi.fn().mockReturnValue({ siloId: "silo-a", principalId: "principal-1" }),
		authority: { submit: vi.fn().mockResolvedValue({ validationId: "validation-1", taskId: "task-1" }) },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillAuthoringValidationSubmissionRouter(dependencies));
	return { app, dependencies };
}

describe("skill authoring validation submission router", function _DescribeSubmissionRouter()
{
	it("admits only the revision identifier under the caller's authenticated silo", async function _Submits()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-1" });

		expect(response.status).toBe(202);
		expect(response.body).toEqual({ validationId: "validation-1", taskId: "task-1" });
		expect(dependencies.authority.submit).toHaveBeenCalledWith({ siloId: "silo-a", principalId: "principal-1" }, "revision-1");
	});

	it("rejects an unauthenticated caller before consulting validation authority", async function _RejectsAnonymousCaller()
	{
		const { app, dependencies } = _App({ resolveCaller: vi.fn().mockReturnValue(null) });
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-1" });

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "skill_validation_authentication_required" });
		expect(dependencies.authority.submit).not.toHaveBeenCalled();
	});

	it("rejects extra artifact or silo fields before they reach validation authority", async function _RejectsExtraFields()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-1", siloId: "foreign-silo", artifactContentAddress: `sha256:${"a".repeat(64)}` });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "skill_revision_id_required" });
		expect(dependencies.authority.submit).not.toHaveBeenCalled();
	});

	it("maps a denied admission to one non-disclosing conflict", async function _MapsAdmissionConflict()
	{
		const authority = { submit: vi.fn().mockRejectedValue(new SkillAuthoringValidationAdmissionError("foreign silo")) };
		const { app, dependencies } = _App({ authority });
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-1" });

		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "skill_validation_unavailable" });
		expect(dependencies.logger.error).not.toHaveBeenCalled();
	});

	it("returns forbidden when the authenticated Principal cannot review the skill", async function _RejectsUnauthorizedReview()
	{
		const authority = { submit: vi.fn().mockRejectedValue(new SkillAuthoringValidationSubmissionForbiddenError()) };
		const { app, dependencies } = _App({ authority });
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-1" });

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "skill_validation_forbidden" });
		expect(dependencies.logger.error).not.toHaveBeenCalled();
	});

	it("logs internal failures without request body or artifact facts", async function _LogsUnavailableAuthority()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const { app } = _App({ authority: { submit: vi.fn().mockRejectedValue(failure) }, logger });
		const response = await request(app).post("/authoring-validations").send({ skillRevisionId: "revision-secret" });

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "skills.authoring_validation.submit", siloId: "silo-a" }, "Skill validation submission failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("revision-secret");
	});
});
