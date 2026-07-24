import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreatePersonaOnboardingRouter } from "../persona-onboarding.router.js";
import type { PersonaOnboardingRouterDependencies } from "../persona-onboarding.types.js";

/** The reviewed source returned to an authenticated first-run client. */
const _SOURCE = { id: "personal-agent-onboarding", version: 1, questions: [{ id: "relationship", category: "RelationshipRole", prompt: "How should I work with you?", ordinal: 1 }] } as const;

/** Build an isolated Express app with spyable, server-owned onboarding dependencies. */
function _App(overrides: Partial<PersonaOnboardingRouterDependencies> = {})
{
	const dependencies: PersonaOnboardingRouterDependencies = {
		resolveCaller: vi.fn().mockReturnValue({ userId: "oidc-subject", siloId: "silo-1" }),
		profiles: { resolveForCaller: vi.fn().mockResolvedValue({ id: "profile-1" }) },
		source: { getReviewedQuestionSet: vi.fn().mockResolvedValue(_SOURCE) },
		interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "started", interviewId: "interview-1" }), recordAnswerAtomically: vi.fn().mockResolvedValue({ status: "recorded", answerId: "answer-1" }), completeAtomically: vi.fn().mockResolvedValue({ status: "completed" }) },
		drafts: { createAtomically: vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" }) },
		personas: { getApprovalSnapshot: vi.fn().mockResolvedValue({ profileUserId: "oidc-subject", revisionState: "draft", revisionProfileId: "profile-1", interviewState: "completed", insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden" }), approveAndActivateAtomically: vi.fn().mockResolvedValue({ status: "approved" }) },
		clock: { now: function _Now(): Date { return new Date("2026-07-24T12:00:00.000Z"); } },
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreatePersonaOnboardingRouter(dependencies));
	return { app, dependencies };
}

/** Valid three-insight payload, each insight bound to one persisted answer identifier. */
function _DraftBody()
{
	return { insights: [{ answerId: "answer-1", statement: "Be direct." }, { answerId: "answer-2", statement: "Explain tradeoffs." }, { answerId: "answer-3", statement: "Ask before acting." }] };
}

describe("persona onboarding router", function _DescribePersonaOnboardingRouter()
{
	it("returns the server-selected reviewed questions only to an authenticated owner", async function _ReadsReviewedSource()
	{
		const { app, dependencies } = _App();
		const response = await request(app).get("/onboarding/questions");
		expect(response.status).toBe(200);
		expect(response.body.questionSet).toEqual(_SOURCE);
		expect(dependencies.profiles.resolveForCaller).not.toHaveBeenCalled();
	});

	it("does not accept browser-selected profile or question-set coordinates when starting", async function _RejectsCallerCoordinates()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/onboarding/interviews").send({ userId: "other-user" });
		expect(response.status).toBe(400);
		expect(dependencies.interviews.startAtomically).not.toHaveBeenCalled();
	});

	it("starts with the session and host-derived caller plus the fixed reviewed source", async function _StartsInterview()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/onboarding/interviews").send({});
		expect(response.status).toBe(201);
		expect(response.body).toEqual({ interviewId: "interview-1", reused: false, questionSet: _SOURCE });
		expect(dependencies.profiles.resolveForCaller).toHaveBeenCalledWith({ userId: "oidc-subject", siloId: "silo-1" });
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ userId: "oidc-subject", siloId: "silo-1", personaProfileId: "profile-1", questionSetId: _SOURCE.id, questionSetVersion: _SOURCE.version }));
	});

	it("fails closed before all persona operations when authenticated caller resolution fails", async function _RejectsUnauthenticated()
	{
		const { app, dependencies } = _App({ resolveCaller: vi.fn().mockReturnValue(null) });
		expect((await request(app).post("/onboarding/interviews").send({})).status).toBe(401);
		expect((await request(app).post("/onboarding/interviews/interview-1/answers").send({ questionId: "relationship", value: "Direct" })).status).toBe(401);
		expect((await request(app).post("/onboarding/interviews/interview-1/complete").send({})).status).toBe(401);
		expect((await request(app).post("/onboarding/interviews/interview-1/draft").send(_DraftBody())).status).toBe(401);
		expect((await request(app).post("/revisions/revision-1/approve").send({})).status).toBe(401);
		expect(dependencies.profiles.resolveForCaller).not.toHaveBeenCalled();
	});

	it("distinguishes unavailable membership authority from an unauthenticated caller", async function _ReportsMembershipUnavailable()
	{
		const { app, dependencies } = _App({ resolveCaller: vi.fn().mockRejectedValue(new Error("database unavailable")) });
		const response = await request(app).post("/onboarding/interviews").send({});
		expect(response.status).toBe(503);
		expect(response.body.code).toBe("persona_membership_authority_unavailable");
		expect(dependencies.logger.error).toHaveBeenCalledWith(expect.objectContaining({ operation: "persona_onboarding.resolve_caller" }), expect.any(String));
	});

	it("records only bounded answer fields for the caller's resolved profile", async function _Answers()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/onboarding/interviews/interview-1/answers").send({ questionId: "relationship", value: "Challenge me directly" });
		expect(response.status).toBe(201);
		expect(response.body).toEqual({ answerId: "answer-1" });
		expect(dependencies.interviews.recordAnswerAtomically).toHaveBeenCalledWith(expect.objectContaining({ userId: "oidc-subject", personaProfileId: "profile-1", interviewId: "interview-1", questionId: "relationship" }));
	});

	it("returns conflict rather than completing an interview with missing answers", async function _RejectsIncomplete()
	{
		const { app } = _App({ interviews: { startAtomically: vi.fn(), recordAnswerAtomically: vi.fn(), completeAtomically: vi.fn().mockResolvedValue({ status: "incomplete_answers" }) } });
		const response = await request(app).post("/onboarding/interviews/interview-1/complete").send({});
		expect(response.status).toBe(409);
		expect(response.body.code).toBe("persona_interview_incomplete_answers");
	});

	it("creates a draft only from three through five answer-bound insights", async function _CreatesDraft()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/onboarding/interviews/interview-1/draft").send(_DraftBody());
		expect(response.status).toBe(201);
		expect(response.body).toEqual({ personaRevisionId: "revision-1" });
		expect(dependencies.drafts.createAtomically).toHaveBeenCalledWith(expect.objectContaining({ userId: "oidc-subject", siloId: "silo-1", personaProfileId: "profile-1", interviewId: "interview-1", insights: _DraftBody().insights }));
	});

	it("rejects an insight statement beyond the documented four-thousand-character contract", async function _RejectsOversizedInsight()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/onboarding/interviews/interview-1/draft").send({ insights: [{ answerId: "answer-1", statement: "a".repeat(4_001) }, { answerId: "answer-2", statement: "Valid." }, { answerId: "answer-3", statement: "Valid." }] });
		expect(response.status).toBe(400);
		expect(dependencies.drafts.createAtomically).not.toHaveBeenCalled();
	});

	it("approves through the existing atomic evidence authority and does not accept a profile id", async function _Approves()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/revisions/revision-1/approve").send({});
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ approved: true });
		expect(dependencies.personas.approveAndActivateAtomically).toHaveBeenCalledWith(expect.objectContaining({ userId: "oidc-subject", personaProfileId: "profile-1", personaRevisionId: "revision-1" }));
		expect((await request(app).post("/revisions/revision-1/approve").send({ personaProfileId: "other" })).status).toBe(400);
	});
});
