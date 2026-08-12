import { Router, type Request, type Response } from "express";

import { __ApprovePersona } from "../approval/persona-authority.js";
import { PersonaApprovalDenialReasons } from "../approval/persona-authority.types.js";
import { PersonaDraftDenialReasons } from "../drafting/persona-draft-authority.types.js";
import { __CreatePersonaDraftFromInterview } from "../drafting/persona-draft-from-interview.js";
import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __ResolvePersonaInterviewTie, __StartPersonaInterview } from "../interview/persona-interview-authority.js";
import { __EnsurePersonaOnboarding } from "../profile/persona-onboarding-authority.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes, PersonaOnboardingApiStates } from "../profile/persona-lifecycle.types.js";
import { PersonaTieKinds, type PersonaScoreResult } from "../scoring/persona-scorer.types.js";
import type { PersonaOnboardingCaller, PersonaOnboardingRouterDependencies } from "./persona-onboarding.router.types.js";

/** The HTTP status for every interview denial reason. */
const _INTERVIEW_DENIAL_STATUS_BY_REASON: Readonly<Record<PersonaInterviewDenialReasons, number>> = {
	[PersonaInterviewDenialReasons.InvalidCommand]: 400,
	[PersonaInterviewDenialReasons.PersistenceUnavailable]: 503,
	[PersonaInterviewDenialReasons.QuestionSetUnavailable]: 422,
	[PersonaInterviewDenialReasons.NotFoundOrWrongOwner]: 404,
	[PersonaInterviewDenialReasons.RefreshChangeUnavailable]: 404,
	[PersonaInterviewDenialReasons.AlreadyAnswered]: 409,
	[PersonaInterviewDenialReasons.QuestionUnavailable]: 400,
	[PersonaInterviewDenialReasons.InvalidResolution]: 409,
	[PersonaInterviewDenialReasons.AlreadyResolved]: 409,
	[PersonaInterviewDenialReasons.NotInProgress]: 409,
	[PersonaInterviewDenialReasons.IncompleteAnswers]: 409,
	[PersonaInterviewDenialReasons.RefreshInterviewConflict]: 409,
	[PersonaInterviewDenialReasons.Conflict]: 409,
};

/** The HTTP status for every draft denial reason. */
const _DRAFT_DENIAL_STATUS_BY_REASON: Readonly<Record<PersonaDraftDenialReasons, number>> = {
	[PersonaDraftDenialReasons.InvalidCommand]: 400,
	[PersonaDraftDenialReasons.NotFoundOrWrongOwner]: 404,
	[PersonaDraftDenialReasons.InterviewIncomplete]: 400,
	[PersonaDraftDenialReasons.InvalidInsights]: 400,
	[PersonaDraftDenialReasons.TemplateNotSelected]: 400,
	[PersonaDraftDenialReasons.ResolutionRequired]: 409,
	[PersonaDraftDenialReasons.DerivationMismatch]: 409,
	[PersonaDraftDenialReasons.Conflict]: 400,
	[PersonaDraftDenialReasons.PersistenceUnavailable]: 503,
};

/** The HTTP status for every approval denial reason. */
const _APPROVAL_DENIAL_STATUS_BY_REASON: Readonly<Record<PersonaApprovalDenialReasons, number>> = {
	[PersonaApprovalDenialReasons.InvalidCommand]: 400,
	[PersonaApprovalDenialReasons.NotFound]: 404,
	[PersonaApprovalDenialReasons.WrongOwner]: 404,
	[PersonaApprovalDenialReasons.NotDraft]: 409,
	[PersonaApprovalDenialReasons.InterviewIncomplete]: 409,
	[PersonaApprovalDenialReasons.InvalidInsights]: 409,
	[PersonaApprovalDenialReasons.TemplateMismatch]: 409,
	[PersonaApprovalDenialReasons.TemplateSelectionMismatch]: 409,
	[PersonaApprovalDenialReasons.MutableSoulPolicy]: 409,
	[PersonaApprovalDenialReasons.Conflict]: 409,
};

/**
 * Creates the persona onboarding router. Every route serves only the signed-in owner.
 *
 * Mounted at /api/v1/me/persona, it exposes the whole onboarding flow: read status, start or resume the
 * interview, answer a question, complete it, break a tie, create a draft, approve it.
 *
 * Each route reads the caller from the session, and the profile id and question set are chosen by the
 * server, never by the browser. A route may take a resource id from the URL, but the use case behind it
 * re-checks that the id belongs to the signed-in owner before anything changes. The router calls the
 * interview, draft, and approval use cases but never writes persona text itself. Together this means a
 * browser cannot reach another user's onboarding state, and cannot skip a step.
 *
 * Called by: {@link _CreatePersonaOnboardingRouter}, which supplies the Prisma-backed dependencies, and
 * directly by `apps/opencrane/src/app/__tests__/persona-user-onboarding.integration.test.ts` with fakes.
 *
 * @param dependencies - Caller resolution, the five persistence ports, a clock, a logger, and the
 * onboarding workflow notification port.
 * @returns An Express router to mount below /me/persona.
 * @see PersonaOnboardingRouterDependencies
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
			const status = await dependencies.status.readStatus(caller.siloId, caller.userId);
			if (status.interviewId !== null) await dependencies.workflow.surveyStarted(caller, status.interviewId);
			response.status(200).json(status);
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
		if (!_isEmptyObject(request.body)) { _respond(response, 400, "invalid_persona_interview"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, refreshConfigurationChangeId: null, questionSetId: ready.questionSet.id, questionSetVersion: ready.questionSet.version, ...ready.derivation, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			const questions = await dependencies.questions.getQuestions(result.interviewId, ready.personaProfileId, caller.userId);
			if (questions === null || questions.length === 0) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			await dependencies.workflow.surveyStarted(caller, result.interviewId);
			response.status(200).json({ interviewId: result.interviewId, state: PersonaOnboardingApiStates.InProgress, reused: result.outcome === PersonaLifecycleOutcomes.AlreadyInProgress, questions: _UnansweredQuestions(questions) });
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
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: ready.personaProfileId, refreshConfigurationChangeId: configurationChangeId, questionSetId: ready.questionSet.id, questionSetVersion: ready.questionSet.version, ...ready.derivation, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			const questions = await dependencies.questions.getQuestions(result.interviewId, ready.personaProfileId, caller.userId);
			if (questions === null || questions.length === 0) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			await dependencies.workflow.surveyStarted(caller, result.interviewId);
			response.status(200).json({ interviewId: result.interviewId, state: PersonaOnboardingApiStates.InProgress, reused: result.outcome === PersonaLifecycleOutcomes.AlreadyInProgress, questions: _UnansweredQuestions(questions) });
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
			const choiceId = _answerChoiceId(request.body, questionId, questions);
			if (choiceId === null) { _respond(response, 400, "invalid_persona_answer"); return; }
			const result = await __RecordPersonaInterviewAnswer(dependencies.interviews, { userId: caller.userId, personaProfileId: ready.personaProfileId, interviewId, questionId, choiceId, answeredAt: dependencies.clock.now().toISOString() });
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
			response.status(200).json({ interviewId, state: result.score.resolutionRequired === null ? PersonaOnboardingApiStates.Completed : PersonaOnboardingApiStates.Resolution, ..._scoreProjection(result.score) });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.complete", siloId: caller.siloId }, "Persona onboarding completion failed");
			_respond(response, 503, "persona_onboarding_unavailable");
		}
	});

	router.post("/interviews/:interviewId/resolutions/:kind", async function _resolveTie(request: Request, response: Response)
	{
		const caller = _requireCaller(request, response, dependencies);
		const interviewId = request.params["interviewId"];
		const kind = request.params["kind"];
		if (caller === null) return;
		const selectedValue = _selectedResolution(request.body);
		if (typeof interviewId !== "string" || !_isTieKind(kind) || selectedValue === null) { _respond(response, 400, "invalid_persona_resolution"); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const result = await __ResolvePersonaInterviewTie(dependencies.interviews, { userId: caller.userId, personaProfileId: ready.personaProfileId, interviewId, kind, selectedValue, resolvedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _interviewDenialStatus(result.reason), result.reason); return; }
			response.status(201).json({ interviewId, state: result.score.resolutionRequired === null ? PersonaOnboardingApiStates.Completed : PersonaOnboardingApiStates.Resolution, ..._scoreProjection(result.score) });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "persona_onboarding.resolve_tie", siloId: caller.siloId }, "Persona tie resolution failed");
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
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _draftDenialStatus(result.reason), result.reason); return; }
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
		if (typeof personaRevisionId !== "string" || !personaRevisionId.trim() || !_isEmptyObject(request.body)) { _respond(response, 400, PersonaApprovalDenialReasons.InvalidCommand); return; }
		try
		{
			const ready = await _ensure(caller, dependencies);
			if (ready === null) { _respond(response, 503, "persona_onboarding_unavailable"); return; }
			const beforeApproval = await dependencies.status.readStatus(caller.siloId, caller.userId);
			if (beforeApproval.personaRevisionId !== personaRevisionId || beforeApproval.interviewId === null) { _respond(response, 409, "persona_revision_not_current"); return; }
			const result = await __ApprovePersona(dependencies.approval, { personaProfileId: ready.personaProfileId, personaRevisionId, userId: caller.userId, approvedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === PersonaLifecycleOutcomes.Denied) { _respond(response, _approvalDenialStatus(result.reason), result.reason); return; }
			await dependencies.workflow.personaApproved(caller, { interviewId: beforeApproval.interviewId, personaRevisionId });
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

/** Returns the caller from the session, or writes a 401 that reveals nothing and returns null. */
function _requireCaller(request: Request, response: Response, dependencies: PersonaOnboardingRouterDependencies): PersonaOnboardingCaller | null
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) _respond(response, 401, "persona_authentication_required");
	return caller;
}

/** Provisions the profile and question set on the server, returning null when that fails. Their identifiers never reach the browser. */
async function _ensure(caller: PersonaOnboardingCaller, dependencies: PersonaOnboardingRouterDependencies): Promise<Extract<Awaited<ReturnType<typeof __EnsurePersonaOnboarding>>, { readonly outcome: PersonaLifecycleOutcomes.Ready }> | null>
{
	const result = await __EnsurePersonaOnboarding(dependencies.onboarding, { siloId: caller.siloId, userId: caller.userId, provisionedAt: dependencies.clock.now().toISOString() });
	return result.outcome === PersonaLifecycleOutcomes.Ready ? result : null;
}

/** Returns the body's `choiceId` only when it is one of that question's own choices, and the body has no other field. */
function _answerChoiceId(body: unknown, questionId: unknown, questions: readonly { readonly id: string; readonly choices: readonly { readonly id: string }[] }[] | null): string | null
{
	if (typeof questionId !== "string" || body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const choiceId = (body as Record<string, unknown>)["choiceId"];
	if (Object.keys(body).length !== 1 || typeof choiceId !== "string" || !choiceId.trim()) return null;
	const question = questions?.find(function _Matches(candidate) { return candidate.id === questionId; });
	return question?.choices.some(function _Choice(choice) { return choice.id === choiceId; }) === true ? choiceId : null;
}

/** Returns the HTTP status for an interview denial. A row owned by someone else looks the same as a missing one. */
function _interviewDenialStatus(reason: PersonaInterviewDenialReasons): number
{
	return _INTERVIEW_DENIAL_STATUS_BY_REASON[reason];
}

/** Returns the HTTP status for a draft denial. */
function _draftDenialStatus(reason: PersonaDraftDenialReasons): number
{
	return _DRAFT_DENIAL_STATUS_BY_REASON[reason];
}

/** Returns the HTTP status for an approval denial. Every reason is listed, so a conflict can never come out as a 400. */
function _approvalDenialStatus(reason: PersonaApprovalDenialReasons): number
{
	return _APPROVAL_DENIAL_STATUS_BY_REASON[reason];
}

/** Returns whether the body is an empty object, which is all these routes accept. */
function _isEmptyObject(value: unknown): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** Returns the body's trimmed `selectedValue`, or null when the body carries any other field. */
function _selectedResolution(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return null;
	const selectedValue = (value as Record<string, unknown>)["selectedValue"];
	return typeof selectedValue === "string" && selectedValue.trim() ? selectedValue.trim() : null;
}

/** Returns whether a URL segment is one of the tie kinds. */
function _isTieKind(value: unknown): value is PersonaTieKinds
{
	return typeof value === "string" && Object.values(PersonaTieKinds).includes(value as PersonaTieKinds);
}

/** Turns a score into the response body, leaving out the insights and the compiled instructions. */
function _scoreProjection(score: PersonaScoreResult): { readonly resolution: PersonaScoreResult["resolutionRequired"]; readonly result: { readonly displayName: string; readonly primaryColour: string; readonly secondaryColour: string; readonly modifier: string; readonly colourScores: PersonaScoreResult["colours"]; readonly opennessScores: PersonaScoreResult["openness"]; readonly insights: readonly string[]; readonly instructionPreview: null } | null }
{
	if (score.primary === null || score.secondary === null || score.modifier === null) return { resolution: score.resolutionRequired, result: null };
	return { resolution: score.resolutionRequired, result: { displayName: "Persona result", primaryColour: score.primary, secondaryColour: score.secondary, modifier: score.modifier, colourScores: score.colours, opennessScores: score.openness, insights: [], instructionPreview: null } };
}

/** Marks every question unanswered, which the shared resume shape requires. */
function _UnansweredQuestions<Question extends { readonly id: string }>(questions: readonly Question[]): readonly (Question & { readonly selectedChoiceId: null })[]
{
	return questions.map(function _Unanswered(question) { return { ...question, selectedChoiceId: null }; });
}

/** Write one bounded JSON problem response. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}
