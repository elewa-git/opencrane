import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@opencrane/backend/observability";

import { _PersonaOnboardingOpenapiPaths } from "../openapi";
import { __CreatePersonaOnboardingRouter } from "../persona-onboarding.router";
import type { PersonaOnboardingRouterDependencies } from "../persona-onboarding.router.types";
import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type PersonaApprovalSnapshot } from "../../approval/persona-authority.types";
import { PersonaDraftDenialReasons } from "../../drafting/persona-draft-authority.types";
import { PersonaInterviewDenialReasons, PersonaOnboardingApiStates } from "../../profile/persona-lifecycle.types";

/** Fully resolved score used by route fakes. */
const _SCORE = { orderedAnswerIds: ["answer-1"], orderedChoiceIds: ["q1:a"], colours: { red: 1, yellow: 0, green: 0, blue: 1, total: 2 }, openness: { explorer: 1, guardian: 0, total: 1 }, tieResolutions: [], primary: "red", secondary: "blue", modifier: "explorer", resolutionRequired: null } as const;

/** Builds a router with authenticated owner identity and observable authority ports. */
function _dependencies(overrides: Partial<PersonaOnboardingRouterDependencies> = {}): PersonaOnboardingRouterDependencies
{
	return {
		resolveCaller: function _caller() { return { siloId: "silo-1", userId: "user-1" }; },
		onboarding: { ensureAtomically: vi.fn().mockResolvedValue({ outcome: "ready", personaProfileId: "profile-1", questionSet: { id: "personal-agent-onboarding", version: 1 }, derivation: { scoringPolicyId: "policy", scoringPolicyVersion: 1, interpolationMapId: "map", interpolationMapVersion: 1 } }) },
		interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "started", interviewId: "interview-1" }), recordAnswerAtomically: vi.fn().mockResolvedValue({ status: "recorded", answerId: "answer-1" }), completeAtomically: vi.fn().mockResolvedValue({ status: "completed", score: _SCORE }), resolveTieAtomically: vi.fn().mockResolvedValue({ status: "recorded", score: _SCORE }) },
		questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "q1", category: "Pace", prompt: "role", ordinal: 1, choices: [{ id: "a", label: "choice", ordinal: 1 }] }]) },
		drafts: { createFromInterviewAtomically: vi.fn().mockResolvedValue({ status: "created", personaRevisionId: "revision-1" }) },
		approval: { getApprovalSnapshot: vi.fn(), approveAndActivateAtomically: vi.fn() },
		clock: { now: function _now() { return new Date("2026-07-26T12:00:00.000Z"); } },
		logger: { error: vi.fn() } as unknown as Logger,
		status: { readStatus: vi.fn().mockResolvedValue({ state: PersonaOnboardingApiStates.Review, interviewId: "interview-1", answeredQuestionCount: 10, questionCount: 10, personaRevisionId: "revision-1", questions: [], resolution: null, result: null }) },
		workflow: { surveyStarted: vi.fn(), personaApproved: vi.fn() },
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

/** Build one valid approval snapshot with focused denial overrides. */
function _approvalSnapshot(overrides: Partial<PersonaApprovalSnapshot> = {}): PersonaApprovalSnapshot
{
	return { profileUserId: "user-1", activeRevisionId: null, revisionState: PersonaApprovalRevisionStates.Draft, revisionProfileId: "profile-1", interviewState: PersonaApprovalInterviewStates.Completed, insightCount: 3, templateDigestMatches: true, templateSelectionMatches: true, durableSoulMutationPolicy: "forbidden", ...overrides };
}

describe("__CreatePersonaOnboardingRouter", function _describe()
{
	it("returns only durable resumable onboarding metadata for the authenticated owner", async function _status()
	{
		const status = { state: PersonaOnboardingApiStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null, questions: [], resolution: null, result: null } as const;
		const dependencies = _dependencies({ status: { readStatus: vi.fn().mockResolvedValue(status) } });
		const response = await request(_app(dependencies)).get("/api/v1/me/persona/");
		expect(response.status).toBe(200);
		expect(response.body).toEqual(status);
		expect(dependencies.status.readStatus).toHaveBeenCalledWith("silo-1", "user-1");
	});

	it("retries a missing durable survey notification whenever status resumes an interview", async function _ReconcilesSurveyNotification()
	{
		const status = { state: PersonaOnboardingApiStates.Interview, interviewId: "interview-1", answeredQuestionCount: 0, questionCount: 1, personaRevisionId: null, questions: [], resolution: null, result: null } as const;
		const surveyStarted = vi.fn().mockRejectedValueOnce(new Error("induced notification interruption")).mockResolvedValue(undefined);
		const dependencies = _dependencies({ status: { readStatus: vi.fn().mockResolvedValue(status) }, workflow: { surveyStarted, personaApproved: vi.fn() } });

		await request(_app(dependencies)).get("/api/v1/me/persona/").expect(503);
		const recovered = await request(_app(dependencies)).get("/api/v1/me/persona/").expect(200);

		expect(recovered.body).toEqual(status);
		expect(surveyStarted).toHaveBeenCalledTimes(2);
		expect(surveyStarted).toHaveBeenNthCalledWith(2, { siloId: "silo-1", userId: "user-1" }, "interview-1");
	});
	it("requires session-derived caller identity before it reveals an onboarding flow", async function _requiresCaller()
	{
		const response = await request(_app(_dependencies({ resolveCaller: function _none() { return null; } }))).post("/api/v1/me/persona/interview").send({});
		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "persona_authentication_required" });
	});

	it("starts the reviewed server-selected questionnaire from trusted ownership coordinates", async function _starts()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interview").send({});
		expect(response.status).toBe(200);
		expect(response.body.interviewId).toBe("interview-1");
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", questionSetId: "personal-agent-onboarding", questionSetVersion: 1 }));
	});

	it("rejects browser-supplied ownership coordinates outside the empty request contract", async function _RejectsOwnershipBody()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interview").send({ personaProfileId: "forged", siloId: "forged" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "invalid_persona_interview" });
		expect(dependencies.interviews.startAtomically).not.toHaveBeenCalled();
	});

	it.each([
		[PersonaInterviewDenialReasons.InvalidCommand, 400],
		[PersonaInterviewDenialReasons.PersistenceUnavailable, 503],
		[PersonaInterviewDenialReasons.QuestionSetUnavailable, 422],
		[PersonaInterviewDenialReasons.NotFoundOrWrongOwner, 404],
		[PersonaInterviewDenialReasons.RefreshChangeUnavailable, 404],
		[PersonaInterviewDenialReasons.AlreadyAnswered, 409],
		[PersonaInterviewDenialReasons.QuestionUnavailable, 400],
		[PersonaInterviewDenialReasons.NotInProgress, 409],
		[PersonaInterviewDenialReasons.IncompleteAnswers, 409],
		[PersonaInterviewDenialReasons.RefreshInterviewConflict, 409],
	] as const)("maps interview denial %s to HTTP %i", async function _mapsInterviewDenial(reason, expectedStatus)
	{
		const dependencies = _dependencies({ interviews: { startAtomically: vi.fn().mockResolvedValue({ status: reason }), recordAnswerAtomically: vi.fn(), completeAtomically: vi.fn(), resolveTieAtomically: vi.fn() } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interview").send({});

		expect(response.status).toBe(expectedStatus);
		expect(response.body).toEqual({ error: reason });
	});

	it("starts a refresh interview only from the route-bound accepted proposal identity", async function _startsRefresh()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/refreshes/change-1/interview").send({});
		expect(response.status).toBe(200);
		expect(dependencies.interviews.startAtomically).toHaveBeenCalledWith(expect.objectContaining({ personaProfileId: "profile-1", refreshConfigurationChangeId: "change-1" }));
	});

	it("documents the non-disclosing missing-refresh response in the public contract", function _RefreshNotFoundContract()
	{
		expect(_PersonaOnboardingOpenapiPaths["/me/persona/refreshes/{configurationChangeId}/interview"].post.responses[404]).toBeDefined();
	});

	it("returns the existing questions when a lost refresh-start response is retried", async function _ReplaysRefreshStart()
	{
		const dependencies = _dependencies({ interviews: { startAtomically: vi.fn().mockResolvedValue({ status: "already_in_progress", interviewId: "interview-existing" }), recordAnswerAtomically: vi.fn(), completeAtomically: vi.fn(), resolveTieAtomically: vi.fn() } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/refreshes/change-1/interview").send({});

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ interviewId: "interview-existing", state: "in_progress", reused: true });
		expect(response.body.questions).toHaveLength(1);
		expect(dependencies.questions.getQuestions).toHaveBeenCalledWith("interview-existing", "profile-1", "user-1");
	});

	it("rejects a choice that does not belong to the reviewed question", async function _rejectsUnsupportedRole()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/answers/q1").send({ choiceId: "forged" });
		expect(response.status).toBe(400);
		expect(dependencies.interviews.recordAnswerAtomically).not.toHaveBeenCalled();
	});

	it("accepts an answer for a question retained by the resumed interview revision", async function _answersPinnedQuestion()
	{
		const dependencies = _dependencies({ questions: { getQuestions: vi.fn().mockResolvedValue([{ id: "v1-only-question", category: "Pace", prompt: "reviewed prompt", ordinal: 1, choices: [{ id: "reviewed-choice", label: "Reviewed", ordinal: 1 }] }]) } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/answers/v1-only-question").send({ choiceId: "reviewed-choice" });
		expect(response.status).toBe(201);
		expect(dependencies.interviews.recordAnswerAtomically).toHaveBeenCalledWith(expect.objectContaining({ questionId: "v1-only-question", choiceId: "reviewed-choice" }));
	});

	it("records a successful tie resolution and keeps the pre-draft label transport-generic", async function _ResolvesTie()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/resolutions/primary").send({ selectedValue: "red" });

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ interviewId: "interview-1", state: "completed", resolution: null, result: { displayName: "Persona result", primaryColour: "red", modifier: "explorer" } });
		expect(dependencies.interviews.resolveTieAtomically).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1", kind: "primary", selectedValue: "red" }));
	});

	it("creates a draft without accepting browser-supplied insight text", async function _createsServerDraft()
	{
		const dependencies = _dependencies();
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/draft").send({});
		expect(response.status).toBe(201);
		expect(dependencies.drafts.createFromInterviewAtomically).toHaveBeenCalledWith(expect.objectContaining({ interviewId: "interview-1", personaProfileId: "profile-1" }));
	});

	it.each([
		[PersonaDraftDenialReasons.InvalidCommand, 400],
		[PersonaDraftDenialReasons.NotFoundOrWrongOwner, 404],
		[PersonaDraftDenialReasons.InterviewIncomplete, 400],
		[PersonaDraftDenialReasons.InvalidInsights, 400],
		[PersonaDraftDenialReasons.TemplateNotSelected, 400],
		[PersonaDraftDenialReasons.Conflict, 400],
		[PersonaDraftDenialReasons.PersistenceUnavailable, 503],
	] as const)("maps draft denial %s to HTTP %i", async function _mapsDraftDenial(reason, expectedStatus)
	{
		const dependencies = _dependencies({ drafts: { createFromInterviewAtomically: vi.fn().mockResolvedValue({ status: reason }) } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/interviews/interview-1/draft").send({});

		expect(response.status).toBe(expectedStatus);
		expect(response.body).toEqual({ error: reason });
	});

	it("approves only the exact owner-visible draft selected by its path coordinate", async function _approvesDraft()
	{
		const dependencies = _dependencies({ approval: { getApprovalSnapshot: vi.fn().mockResolvedValue(_approvalSnapshot()), approveAndActivateAtomically: vi.fn().mockResolvedValue({ status: PersonaApprovalPersistenceStatuses.Approved }) } });

		const response = await request(_app(dependencies)).post("/api/v1/me/persona/drafts/revision-1/approve").send({});
		expect(response.status).toBe(200);
		expect(dependencies.approval.approveAndActivateAtomically).toHaveBeenCalledWith(expect.objectContaining({ personaProfileId: "profile-1", personaRevisionId: "revision-1", userId: "user-1" }));
	});

	it("replays a committed exact-active approval and retries its onboarding advancement", async function _ReplaysCommittedApproval()
	{
		const dependencies = _dependencies({ approval: { getApprovalSnapshot: vi.fn().mockResolvedValue(_approvalSnapshot({ revisionState: PersonaApprovalRevisionStates.Approved, activeRevisionId: "revision-1" })), approveAndActivateAtomically: vi.fn() } });

		const response = await request(_app(dependencies)).post("/api/v1/me/persona/drafts/revision-1/approve").send({});

		expect(response.status).toBe(200);
		expect(dependencies.approval.approveAndActivateAtomically).not.toHaveBeenCalled();
		expect(dependencies.workflow.personaApproved).toHaveBeenCalledWith({ siloId: "silo-1", userId: "user-1" }, { interviewId: "interview-1", personaRevisionId: "revision-1" });
	});

	it("maps an invalid approval command to HTTP 400", async function _invalidApprovalCommand()
	{
		const response = await request(_app(_dependencies())).post("/api/v1/me/persona/drafts/%20/approve").send({});

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: PersonaApprovalDenialReasons.InvalidCommand });
	});

	it.each([
		[PersonaApprovalDenialReasons.NotFound, null, PersonaApprovalPersistenceStatuses.Approved, 404],
		[PersonaApprovalDenialReasons.WrongOwner, _approvalSnapshot({ profileUserId: "user-2" }), PersonaApprovalPersistenceStatuses.Approved, 404],
		[PersonaApprovalDenialReasons.NotDraft, _approvalSnapshot({ revisionState: PersonaApprovalRevisionStates.Approved }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.InterviewIncomplete, _approvalSnapshot({ interviewState: PersonaApprovalInterviewStates.InProgress }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.InvalidInsights, _approvalSnapshot({ insightCount: 2 }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.TemplateMismatch, _approvalSnapshot({ templateDigestMatches: false }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.TemplateSelectionMismatch, _approvalSnapshot({ templateSelectionMatches: false }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.MutableSoulPolicy, _approvalSnapshot({ durableSoulMutationPolicy: "mutable" }), PersonaApprovalPersistenceStatuses.Approved, 409],
		[PersonaApprovalDenialReasons.Conflict, _approvalSnapshot(), PersonaApprovalPersistenceStatuses.Conflict, 409],
	] as const)("maps approval denial %s to its HTTP status", async function _mapsApprovalDenial(reason, snapshot, persistenceStatus, expectedStatus)
	{
		const dependencies = _dependencies({ approval: { getApprovalSnapshot: vi.fn().mockResolvedValue(snapshot), approveAndActivateAtomically: vi.fn().mockResolvedValue({ status: persistenceStatus }) } });
		const response = await request(_app(dependencies)).post("/api/v1/me/persona/drafts/revision-1/approve").send({});

		expect(response.status).toBe(expectedStatus);
		expect(response.body).toEqual({ error: reason });
	});
});
