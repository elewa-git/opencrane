import { Router, type Request, type Response } from "express";

import { __ApprovePersona } from "../approval/persona-authority.js";
import { PersonaApprovalDenialReasons } from "../approval/persona-authority.types.js";
import { __CreatePersonaDraftFromInterview } from "../drafting/persona-draft-from-interview.js";
import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "../interview/persona-interview-authority.js";
import { __EnsurePersonaOnboarding } from "../profile/persona-onboarding-authority.js";
import { PERSONA_ONBOARDING_TEMPLATE_ANSWERS } from "../profile/persona-onboarding-catalogue.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes, PersonaOnboardingApiStates } from "../profile/persona-lifecycle.types.js";
import type { PersonaOnboardingCaller, PersonaOnboardingRouterDependencies } from "./persona-onboarding.router.types.js";

/**
 * Creates the browser-session-authenticated, self-only persona onboarding router.
 *
 * Each route derives the caller from the session and keeps profile and question-set coordinates
 * server-owned. A route may carry an opaque resource identifier, but its domain authority rebinds
 * that identifier to the authenticated owner before transition. The router orchestrates interview,
 * draft, and approval authorities but never composes persona text itself, so the browser can
 * progress through onboarding without selecting another user's lifecycle state or bypassing a
 * domain transition.
 */
export function __CreatePersonaOnboardingRouter(dependencies: PersonaOnboardingRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _status(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		if (caller === null) return;
		try
		{
			response.status(200).json(await dependencies.status.readStatus(caller.siloId, caller.userId));
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.status", siloId: caller.siloId }, "Persona onboarding status read failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/interview", async function _start(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		if (caller === null) return;
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, refreshConfigurationChangeId: null, questionSetId: ready.questionSet.id, questionSetVersion: ready.questionSet.version, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			const questions = await dependencies.questions.getQuestions(result.interviewId, ready.personaProfileId, caller.userId);
			if (questions === null || questions.length === 0) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			response.status(200).json({ interviewId: result.interviewId, state: PersonaOnboardingApiStates.InProgress, reused: result.outcome === PersonaLifecycleOutcomes.AlreadyInProgress, questions });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.start", siloId: caller.siloId }, "Persona onboarding interview start failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/refreshes/:configurationChangeId/interview", async function _startRefresh(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const configurationChangeId = request.params["configurationChangeId"];
		if (caller === null) return;
		if (typeof configurationChangeId !== "string" || !_isEmptyObject(request.body)) { _respond(response, 400, "invalid_persona_refresh"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, refreshConfigurationChangeId: configurationChangeId, questionSetId: ready.questionSet.id, questionSetVersion: ready.questionSet.version, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			const questions = await dependencies.questions.getQuestions(result.interviewId, ready.personaProfileId, caller.userId);
			if (questions === null || questions.length === 0) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			response.status(200).json({ interviewId: result.interviewId, state: PersonaOnboardingApiStates.InProgress, reused: result.outcome === PersonaLifecycleOutcomes.AlreadyInProgress, questions });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.start_refresh", siloId: caller.siloId }, "Persona refresh interview start failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/interviews/:interviewId/answers/:questionId", async function _answer(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const interviewId = request.params["interviewId"];
		const questionId = request.params["questionId"];
		if (caller === null) return;
		if (typeof interviewId !== "string" || typeof questionId !== "string") { _respond(response, 400, "invalid_persona_answer"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const questions = await dependencies.questions.getQuestions(interviewId, ready.personaProfileId, caller.userId);
			const value = _answerValue(request.body, questionId, questions);
			if (value === null) { _respond(response, 400, "invalid_persona_answer"); return; }
			const result = await __RecordPersonaInterviewAnswer(dependencies.interviews, { userId: caller.userId, personaProfileId: ready.personaProfileId, interviewId, questionId, value, answeredAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(201).json({ answerId: result.answerId });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.answer", siloId: caller.siloId }, "Persona onboarding answer failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/interviews/:interviewId/complete", async function _complete(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const interviewId = request.params["interviewId"];
		if (caller === null) return;
		if (typeof interviewId !== "string" || !_isEmptyObject(request.body)) { _respond(response, 400, "invalid_persona_completion"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __CompletePersonaInterview(dependencies.interviews, { userId: caller.userId, personaProfileId: ready.personaProfileId, interviewId, completedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(200).json({ interviewId, state: PersonaOnboardingApiStates.Completed });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.complete", siloId: caller.siloId }, "Persona onboarding completion failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/interviews/:interviewId/draft", async function _draft(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const interviewId = request.params["interviewId"];
		if (caller === null) return;
		if (typeof interviewId !== "string" || !_isEmptyObject(request.body)) { _respond(response, 400, "invalid_persona_draft"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __CreatePersonaDraftFromInterview(dependencies.drafts, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, interviewId, authoredAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(201).json({ personaRevisionId: result.personaRevisionId, state: PersonaOnboardingApiStates.Draft });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.draft", siloId: caller.siloId }, "Persona onboarding draft failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/drafts/:personaRevisionId/approve", async function _approve(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const personaRevisionId = request.params["personaRevisionId"];
		if (caller === null) return;
		if (typeof personaRevisionId !== "string" || !_isEmptyObject(request.body)) { _respond(response, 400, "invalid_persona_approval"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __ApprovePersona(dependencies.approval, { personaProfileId: ready.personaProfileId, personaRevisionId, userId: caller.userId, approvedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _approvalDenialStatus(result.reason), result.reason); return; }
			response.status(200).json({ personaRevisionId, state: PersonaOnboardingApiStates.Approved });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.approve", siloId: caller.siloId }, "Persona onboarding approval failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	return router;
}

/** Resolve one session-derived caller or write a non-disclosing authentication denial. */
function _requireCaller(request: Request, response: Response, dependencies: PersonaOnboardingRouterDependencies): PersonaOnboardingCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "persona_authentication_required");
	return caller;
}

/** Provision the server-owned profile and catalogue without exposing their coordinates to the browser. */
async function _ensure(caller: PersonaOnboardingCaller, dependencies: PersonaOnboardingRouterDependencies): Promise<{ readonly personaProfileId: string; readonly questionSet: { readonly id: string; readonly version: number } } | null>
{
	const result = await __EnsurePersonaOnboarding(dependencies.onboarding, { siloId: caller.siloId, userId: caller.userId, provisionedAt: dependencies.clock.now().toISOString() });
	return result.outcome === PersonaLifecycleOutcomes.Ready ? result : null;
}

/** Parse one permitted answer value without accepting arbitrary question IDs or unsupported role selection. */
function _answerValue(body: unknown, questionId: unknown, questions: readonly { readonly id: string }[] | null): string | null
{
	if (typeof questionId !== "string" || body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const value = (body as Record<string, unknown>)["value"];
	if (Object.keys(body).length !== 1 || typeof value !== "string" || !value.trim()) return null;
	if (questions === null || !questions.some(function _matches(question) { return question.id === questionId; })) return null;
	if (questionId === "relationship-role" && value.trim() !== PERSONA_ONBOARDING_TEMPLATE_ANSWERS.relationshipRole) return null;
	if (questionId === "challenge-support" && !PERSONA_ONBOARDING_TEMPLATE_ANSWERS.challengeSupport.includes(value.trim() as (typeof PERSONA_ONBOARDING_TEMPLATE_ANSWERS.challengeSupport)[number])) return null;
	return value.trim();
}

/** Map interview lifecycle denials to a bounded HTTP status without leaking another owner's state. */
function _interviewDenialStatus(reason: string): number
{
	return reason === PersonaInterviewDenialReasons.PersistenceUnavailable ? 503 : reason === PersonaInterviewDenialReasons.QuestionSetUnavailable ? 422 : reason === PersonaInterviewDenialReasons.NotFoundOrWrongOwner || reason === PersonaInterviewDenialReasons.RefreshChangeUnavailable ? 404 : reason === PersonaInterviewDenialReasons.AlreadyAnswered || reason === PersonaInterviewDenialReasons.NotInProgress || reason === PersonaInterviewDenialReasons.IncompleteAnswers || reason === PersonaInterviewDenialReasons.RefreshInterviewConflict ? 409 : 400;
}

/** Map persona-approval denials explicitly so concurrent commits cannot fall through to a bad request. */
function _approvalDenialStatus(reason: PersonaApprovalDenialReasons): number
{
	return reason === PersonaApprovalDenialReasons.NotFound || reason === PersonaApprovalDenialReasons.WrongOwner ? 404 : reason === PersonaApprovalDenialReasons.InvalidCommand ? 400 : 409;
}

/** Require an empty object for a state transition with no caller-owned coordinates. */
function _isEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
