import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { __CreatePersonaOnboardingRouter } from "../persona-onboarding.router.js";
import type { PersonaOnboardingRouterDependencies } from "../persona-onboarding.router.types.js";
import { PersonaApprovalPersistenceStatuses } from "../../approval/persona-authority.types.js";

/** Builds a router with authenticated owner identity and observable authority ports. */
function _dependencies(overrides: Partial<PersonaOnboardingRouterDependencies> = {}): PersonaOnboardingRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", userId: "user-1" }; },
		onboarding: { ensureAtomically: vi.fn().mockResolvedValue({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 } }) },
		interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "started", interviewId: "interview-1" }), recordAnswerAtomically: vi.fn().mockResolvedValue({ status: "recorded", answerId: "answer-1" }), completeAtomically: vi.fn().mockResolvedValue({ status: "completed" }) },
		questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "relationship-role", category: "RelationshipRole", prompt: "role", ordinal: 1 }]) },
		drafts: { createFromInterviewAtomically: vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" }) },
		approval: { getApprovalSnapshot: vi.fn(), approveAndActivateAtomically: vi.fn() },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		status: { readStatus: vi.fn().mockResolvedValue({ state: "interview", interviewId: null, answeredQuestionCount: 0, questionCount: 8, personaRevisionId: null }) },
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
	it("returns only durable resumable onboarding metadata for the authenticated owner", async function _status()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).get("/api/v1/me/persona/");
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ state: "interview", interviewId: null, answeredQuestionCount: 0, questionCount: 8, personaRevisionId: null });
		expect(dependencies.status.readStatus).toHaveBeenCalledWith("silo-1", "user-1");
	});
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
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", questionSetId: "personal-agent-onboarding", questionSetVersion: 1 }));
	});

	it("starts a refresh interview only from the route-bound accepted proposal identity", async function _startsRefresh()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/refreshes/change-1/interview").send({});
		expect(response.status).toBe(200);
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ personaProfileId: "profile-1", refreshConfigurationChangeId: "change-1" }));
	});

	it("returns the existing questions when a lost refresh-start response is retried", async function _ReplaysRefreshStart()
	{
		const dependencies = _dependencies({ interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "already_in_progress", interviewId: "interview-existing" }), recordAnswerAtomically: vi.fn(), completeAtomically: vi.fn() } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/refreshes/change-1/interview").send({});

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ interviewId: "interview-existing", state: "in_progress", reused: true });
		expect(response.body.questions).toHaveLength(1);
		expect(dependencies.questions.getQuestions).toHaveBeenCalledWith("interview-existing", "profile-1", "user-1");
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
		const dependencies = _dependencies({ questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "v1-only-question", category: "WorkingHabits", prompt: "reviewed prompt", ordinal: 1 }]) } });
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

	it("approves only the exact owner-visible draft selected by its path coordinate", async function _approvesDraft()
	{
		const dependencies = _dependencies({ approval: { getApprovalSnapshot: vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" }), approveAndActivateAtomically: vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Approved }) } });

		const response = await request(_app(dependencies)).post("/api/v1/me/persona/drafts/revision-1/approve").send({});
		expect(response.status).toBe(200);
		expect(dependencies.approval.approveAndActivateAtomically).toHaveBeenCalledWith(expect.objectContaining({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1" }));
	});

	it("maps a concurrent approval conflict to HTTP 409", async function _approvalConflict()
	{
		const dependencies = _dependencies({ approval: { getApprovalSnapshot: vi.fn().mockResolvedValue({ profileUserId: "user-1", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" }), approveAndActivateAtomically: vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Conflict }) } });

		const response = await request(_app(dependencies)).post("/api/v1/me/persona/drafts/revision-1/approve").send({});
		expect(response.status).toBe(409);
		expect(response.body).toEqual({ error: "conflict" });
	});
});
