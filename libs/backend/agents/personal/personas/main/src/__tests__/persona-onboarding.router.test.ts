import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/observability";

import { __CreatePersonaOnboardingRouter } from "../persona-onboarding.router.js";
import type { PersonaOnboardingRouterDependencies } from "../persona-onboarding.router.types.js";

/** Builds a router with authenticated owner identity and observable authority ports. */
function _dependencies(overrides: Partial<PersonaOnboardingRouterDependencies> = {}): PersonaOnboardingRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", userId: "user-1" }; },
		onboarding: { ensureAtomically: vi.fn().mockResolvedValue({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-onboarding", version: 1 } }) },
		interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "started", interviewId: "interview-1" }), recordAnswerAtomically: vi.fn().mockResolvedValue({ status: "recorded", answerId: "answer-1" }), completeAtomically: vi.fn().mockResolvedValue({ status: "completed" }) },
		questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "relationship-role", category: "RelationshipRole", prompt: "role", ordinal: 1 }]) },
		drafts: { createFromInterviewAtomically: vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" }) },
		approval: { getApprovalSnapshot: vi.fn(), approveAndActivateAtomically: vi.fn() },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		...overrides,
	};
}

/** Mounts the router below the public self-persona prefix. */
function _app(dependencies: PersonaOnboardingRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/persona", __CreatePersonaOnboardingRouter(dependencies));
	return app;
}

describe("__CreatePersonaOnboardingRouter", function _describe()
{
	it("requires session-derived caller identity before it reveals an onboarding flow", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).post("/api/v1/me/persona/interview").send({});
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "persona_authentication_required" });
	});

	it("starts the reviewed server-selected questionnaire without accepting browser ownership coordinates", async function _starts()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interview").send({ personaProfileId: "forged", siloId: "forged" });
		expect(response.status).toBe(200);
		expect(response.body.interviewId).toBe("interview-1");
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", questionSetId: "personal-onboarding", questionSetVersion: 1 }));
	});

	it("rejects a role value that cannot select one reviewed SOUL template", async function _rejectsUnsupportedRole()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/answers/relationship-role").send({ value: "assistant" });
		expect(response.status).toBe(400);
		expect(dependencies.interviews.recordAnswerAtomically).not.toHaveBeenCalled();
	});

	it("accepts an answer for a question retained by the resumed interview revision", async function _answersPinnedQuestion()
	{
		const dependencies = _dependencies({ questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "v1-only-question", category: "WorkingHabits", prompt: "legacy reviewed prompt", ordinal: 1 }]) } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/answers/v1-only-question").send({ value: "Use short written updates." });
		expect(response.status).toBe(201);
		expect(dependencies.interviews.recordAnswerAtomically).toHaveBeenCalledWith(expect.objectContaining({ questionId: "v1-only-question", value: "Use short written updates." }));
	});

	it("creates a draft without accepting browser-supplied insight text", async function _createsServerDraft()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/draft").send({});
		expect(response.status).toBe(201);
		expect(dependencies.drafts.createFromInterviewAtomically).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1", personaProfileId: "profile-1" }));
	});
});
