import { Router, type Request, type Response } from "express";

import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "./persona-interview-authority.js";
import { __EnsurePersonaOnboarding } from "./persona-onboarding-authority.js";
import { __CreatePersonaDraftFromInterview } from "./persona-draft-from-interview.js";
import { __ApprovePersona } from "./persona-authority.js";
import { PERSONA_ONBOARDING_TEMPLATE_ANSWERS } from "./persona-onboarding-catalogue.js";
import type { PersonaOnboardingCaller, PersonaOnboardingRouterDependencies } from "./persona-onboarding.router.types.js";

/** Create the browser-session-authenticated, self-only persona onboarding router. */
export function __CreatePersonaOnboardingRouter(dependencies: PersonaOnboardingRouterDependencies): Router
{
	const router = Router();

	router.post("/interview", async function _start(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		if (caller === null) return;
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, questionSetId: ready.questionSet.id, questionSetVersion: ready.questionSet.version, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied") { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			const questions = await dependencies.questions.getQuestions(result.interviewId, ready.personaProfileId, caller.userId);
			if (questions === null || questions.length === 0) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			response.status(200).json({ interviewId: result.interviewId, state: "in_progress", reused: result.outcome === "already_in_progress", questions });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.start", siloId: caller.siloId }, "Persona onboarding interview start failed");
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
			if (result.outcome === "denied") { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
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
			if (result.outcome === "denied") { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(200).json({ interviewId, state: "completed" });
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
			if (result.outcome === "denied") { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(201).json({ personaRevisionId: result.personaRevisionId, state: "draft" });
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
			if (result.outcome === "denied") { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(200).json({ personaRevisionId, state: "approved" });
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
	return result.outcome === "ready" ? result : null;
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
	return reason === "persistence_unavailable" ? 503 : reason === "question_set_unavailable" ? 422 : reason === "not_found_or_wrong_owner" ? 404 : reason === "already_answered" || reason === "not_in_progress" || reason === "incomplete_answers" ? 409 : 400;
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
