import { Router, type Request, type Response } from "express";

import { __ApprovePersona } from "./persona-authority.js";
import { __CreatePersonaDraft } from "./persona-draft-authority.js";
import { __CompletePersonaInterview, __RecordPersonaInterviewAnswer, __StartPersonaInterview } from "./persona-interview-authority.js";
import type { PersonaOnboardingCaller, PersonaOnboardingRouterDependencies } from "./persona-onboarding.types.js";

/** Build the authenticated, owner-only persona onboarding API. */
export function __CreatePersonaOnboardingRouter(dependencies: PersonaOnboardingRouterDependencies): Router
{
	const router = Router();

	router.get("/onboarding/questions", async function _Questions(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		if (!caller) return;
		try
		{
			const source = await dependencies.source.getReviewedQuestionSet();
			if (!source)
			{
				_Problem(response, 503, "persona_onboarding_source_unavailable");
				return;
			}
			response.status(200).json({ questionSet: source });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.questions");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	router.post("/onboarding/interviews", async function _Start(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		if (!caller) return;
		if (!_IsEmptyObject(request.body))
		{
			_Problem(response, 400, "invalid_persona_onboarding_request");
			return;
		}
		try
		{
			// 1. Load the fixed reviewed source before creating evidence so an unavailable seed cannot start an unusable interview.
			const source = await dependencies.source.getReviewedQuestionSet();
			if (!source)
			{
				_Problem(response, 503, "persona_onboarding_source_unavailable");
				return;
			}
			// 2. Resolve the owner profile entirely from authenticated identity and the request host.
			const profile = await dependencies.profiles.resolveForCaller(caller);
			const result = await __StartPersonaInterview(dependencies.interviews, { siloId: caller.siloId, userId: caller.userId, personaProfileId: profile.id, questionSetId: source.id, questionSetVersion: source.version, startedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_InterviewDenial(response, result.reason);
				return;
			}
			response.status(result.outcome === "started" ? 201 : 200).json({ interviewId: result.interviewId, reused: result.outcome === "already_in_progress", questionSet: source });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.start");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	router.post("/onboarding/interviews/:interviewId/answers", async function _Answer(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		const command = _AnswerCommand(request.body);
		const interviewId = request.params["interviewId"];
		if (!caller) return;
		if (!command || !_Identifier(interviewId))
		{
			_Problem(response, 400, "invalid_persona_answer");
			return;
		}
		try
		{
			const profile = await dependencies.profiles.resolveForCaller(caller);
			const result = await __RecordPersonaInterviewAnswer(dependencies.interviews, { userId: caller.userId, personaProfileId: profile.id, interviewId, questionId: command.questionId, value: command.value, answeredAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_InterviewDenial(response, result.reason);
				return;
			}
			response.status(201).json({ answerId: result.answerId });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.answer");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	router.post("/onboarding/interviews/:interviewId/complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		const interviewId = request.params["interviewId"];
		if (!caller) return;
		if (!_Identifier(interviewId) || !_IsEmptyObject(request.body))
		{
			_Problem(response, 400, "invalid_persona_completion");
			return;
		}
		try
		{
			const profile = await dependencies.profiles.resolveForCaller(caller);
			const result = await __CompletePersonaInterview(dependencies.interviews, { userId: caller.userId, personaProfileId: profile.id, interviewId, completedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_InterviewDenial(response, result.reason);
				return;
			}
			response.status(200).json({ completed: true });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.complete");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	router.post("/onboarding/interviews/:interviewId/draft", async function _Draft(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		const insights = _Insights(request.body);
		const interviewId = request.params["interviewId"];
		if (!caller) return;
		if (!insights || !_Identifier(interviewId))
		{
			_Problem(response, 400, "invalid_persona_draft");
			return;
		}
		try
		{
			const profile = await dependencies.profiles.resolveForCaller(caller);
			const result = await __CreatePersonaDraft(dependencies.drafts, { siloId: caller.siloId, userId: caller.userId, personaProfileId: profile.id, interviewId, insights, authoredAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_DraftDenial(response, result.reason);
				return;
			}
			response.status(201).json({ personaRevisionId: result.personaRevisionId });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.draft");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	router.post("/revisions/:personaRevisionId/approve", async function _Approve(request: Request, response: Response): Promise<void>
	{
		const caller = await _Caller(dependencies, request, response);
		const personaRevisionId = request.params["personaRevisionId"];
		if (!caller) return;
		if (!_Identifier(personaRevisionId) || !_IsEmptyObject(request.body))
		{
			_Problem(response, 400, "invalid_persona_approval");
			return;
		}
		try
		{
			const profile = await dependencies.profiles.resolveForCaller(caller);
			const result = await __ApprovePersona(dependencies.personas, { personaProfileId: profile.id, personaRevisionId, userId: caller.userId, approvedAt: dependencies.clock.now().toISOString() });
			if (result.outcome === "denied")
			{
				_ApprovalDenial(response, result.reason);
				return;
			}
			response.status(200).json({ approved: true });
		}
		catch (err)
		{
			_Failed(dependencies, err, "persona_onboarding.approve");
			_Problem(response, 503, "persona_onboarding_authority_unavailable");
		}
	});

	return router;
}

/** Resolve one authenticated caller and keep an unavailable membership authority distinguishable from denial. */
async function _Caller(dependencies: PersonaOnboardingRouterDependencies, request: Request, response: Response): Promise<PersonaOnboardingCaller | null>
{
	try
	{
		const caller = await dependencies.resolveCaller(request);
		if (caller) return caller;
		_Problem(response, 401, "persona_identity_denied");
		return null;
	}
	catch (err)
	{
		_Failed(dependencies, err, "persona_onboarding.resolve_caller");
		_Problem(response, 503, "persona_membership_authority_unavailable");
		return null;
	}
}

/** Parse the only fields accepted while appending one interview answer. */
function _AnswerCommand(value: unknown): { readonly questionId: string; readonly value: string } | null
{
	if (!_ExactObject(value, ["questionId", "value"])) return null;
	const body = value as Record<string, unknown>;
	return _Identifier(body["questionId"]) && typeof body["value"] === "string" ? { questionId: body["questionId"], value: body["value"] } : null;
}

/** Parse three through five answer-bound insight statements without accepting future policy fields. */
function _Insights(value: unknown): readonly { readonly answerId: string; readonly statement: string }[] | null
{
	if (!_ExactObject(value, ["insights"])) return null;
	const insights = (value as Record<string, unknown>)["insights"];
	if (!Array.isArray(insights) || insights.length < 3 || insights.length > 5) return null;
	const parsed = insights.map(function _Insight(item): { readonly answerId: string; readonly statement: string } | null
	{
		if (!_ExactObject(item, ["answerId", "statement"])) return null;
		const insight = item as Record<string, unknown>;
		return _Identifier(insight["answerId"]) && typeof insight["statement"] === "string" && insight["statement"].length <= 4_000 ? { answerId: insight["answerId"], statement: insight["statement"] } : null;
	});
	return parsed.every(function _Valid(insight): insight is { readonly answerId: string; readonly statement: string } { return insight !== null; }) ? parsed : null;
}

/** Require a small exact JSON object so the public API cannot silently gain authority fields. */
function _ExactObject(value: unknown, keys: readonly string[]): boolean
{
	return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(function _Has(key): boolean { return key in value; });
}

/** Recognise an opaque durable identifier without accepting control characters or unbounded values. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Treat an omitted JSON body as an empty request for endpoint contracts that take no body. */
function _IsEmptyObject(value: unknown): boolean
{
	return value === undefined || _ExactObject(value, []);
}

/** Translate lifecycle authority denials into stable HTTP semantics without exposing ownership details. */
function _InterviewDenial(response: Response, reason: string): void
{
	const status = reason === "invalid_command" ? 400 : reason === "persistence_unavailable" ? 503 : reason === "question_set_unavailable" ? 503 : reason === "not_found_or_wrong_owner" || reason === "question_unavailable" ? 404 : 409;
	_Problem(response, status, `persona_interview_${reason}`);
}

/** Translate draft derivation denials while retaining the authoritative reason code. */
function _DraftDenial(response: Response, reason: string): void
{
	const status = reason === "invalid_command" ? 400 : reason === "persistence_unavailable" ? 503 : reason === "not_found_or_wrong_owner" ? 404 : 409;
	_Problem(response, status, `persona_draft_${reason}`);
}

/** Translate approval evidence denials without leaking another owner's profile or revision existence. */
function _ApprovalDenial(response: Response, reason: string): void
{
	const status = reason === "invalid_command" ? 400 : reason === "not_found" || reason === "wrong_owner" ? 404 : 409;
	_Problem(response, status, `persona_approval_${reason}`);
}

/** Emit one bounded HTTP error envelope. */
function _Problem(response: Response, status: number, code: string): void
{
	response.status(status).json({ error: "Persona onboarding request could not be completed.", code });
}

/** Log an unexpected persistence failure without logging answers, insights, or identity values. */
function _Failed(dependencies: PersonaOnboardingRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "Persona onboarding authority failed");
}
