import { Router, type Request, type Response } from "express";

import { UserOnboardingAnswerStatuses, UserOnboardingChatFailureReasons, UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";
import { UserOnboardingChatError } from "./user-onboarding-chat-authority.js";
import type { UserOnboardingPersonaWorkflowPort, UserOnboardingRouterDependencies } from "./user-onboarding.http.types.js";
import { _ParseUserOnboardingAnswerBody } from "./user-onboarding.http.validator.js";
import type { ApprovedPersonaEvidence, UserOnboardingOwner } from "./user-onboarding.types.js";
import { __UserOnboardingAuthority } from "./user-onboarding-authority.js";

/** Create the owner-only durable onboarding status router. */
export function __CreateUserOnboardingRouter(dependencies: UserOnboardingRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _Status(request, response)
	{
		const owner = dependencies.resolveOwner(request);
		if (owner === null) { _Error(response, 401, "onboarding_authentication_required"); return; }
		try
		{
			const onboarding = await dependencies.authority.readOrCreate(owner);
			response.status(200).json(_Projection(onboarding));
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "user_onboarding.read_or_create", siloId: owner.siloId, subjectId: owner.subjectId }, "User onboarding route-state read failed");
			_Error(response, 503, "onboarding_authority_unavailable");
		}
	});
	router.get("/chat", async function _ReadChat(request, response) { await _ChatRequest(dependencies, request, response, "user_onboarding.chat.read", async function _Read(owner) { return { status: 200, body: await dependencies.chatAuthority.read(owner) }; }); });
	router.post("/chat/start", async function _StartChat(request, response) { await _ChatRequest(dependencies, request, response, "user_onboarding.chat.start", async function _Start(owner) { return { status: 200, body: await dependencies.chatAuthority.start(owner) }; }); });
	router.post("/chat/answers", async function _AnswerChat(request, response)
	{
		await _ChatRequest(dependencies, request, response, "user_onboarding.chat.answer", async function _Answer(owner)
		{
			const body = _ParseUserOnboardingAnswerBody(request.body);
			if (body === null) throw new UserOnboardingChatError(UserOnboardingChatFailureReasons.InvalidAnswer);
			const result = await dependencies.chatAuthority.answer(owner, body);
			if (result.status === UserOnboardingAnswerStatuses.IdempotencyConflict || result.status === UserOnboardingAnswerStatuses.StateConflict) return { status: 409, body: { error: `onboarding_chat_${result.status}`, chat: result.chat } };
			return { status: result.status === UserOnboardingAnswerStatuses.Recorded ? 201 : 200, body: result.chat };
		});
	});
	router.post("/chat/conclude", async function _ConcludeChat(request, response) { await _ChatRequest(dependencies, request, response, "user_onboarding.chat.conclude", async function _Conclude(owner) { return { status: 200, body: await dependencies.chatAuthority.conclude(owner) }; }); });
	return router;
}

/** Adapter that advances workflow state only after persona authority success. */
export class UserOnboardingPersonaWorkflowCoordinator implements UserOnboardingPersonaWorkflowPort
{
	/** Durable workflow authority. */
	private readonly authority: __UserOnboardingAuthority;

	/** Bind persona notifications to one durable workflow authority. */
	constructor(authority: __UserOnboardingAuthority)
	{
		this.authority = authority;
	}

	/** @inheritdoc */
	async surveyStarted(owner: UserOnboardingOwner, interviewId: string): Promise<void>
	{
		// Reconcile an already-approved pinned interview before a newer persona interview may be
		// observed. This closes the post-commit notification gap without letting a restart replace
		// the only onboarding evidence that can advance the owner to bootstrap chat.
		await this.authority.readOrCreate(owner);
		_RequireAccepted(await this.authority.startSurvey(owner, interviewId));
	}

	/** @inheritdoc */
	async personaApproved(owner: UserOnboardingOwner, evidence: ApprovedPersonaEvidence): Promise<void>
	{
		_RequireAccepted(await this.authority.recordApprovedPersona(owner, evidence));
	}
}

/** Project routing facts without persona, bootstrap content, or transcript data. */
function _Projection(onboarding: Awaited<ReturnType<__UserOnboardingAuthority["readOrCreate"]>>)
{
	return { workflowVersion: onboarding.workflowVersion, state: onboarding.state, personaInterviewId: onboarding.personaInterviewId, personaRevisionId: onboarding.personaRevisionId, bootstrapConversationId: onboarding.bootstrapConversationId, startedAt: onboarding.startedAt.toISOString(), updatedAt: onboarding.updatedAt.toISOString(), completedAt: onboarding.completedAt?.toISOString() ?? null };
}

/** Fail the persona response when the durable workflow did not accept its evidence. */
function _RequireAccepted(result: Awaited<ReturnType<__UserOnboardingAuthority["startSurvey"]>>): void
{
	if (result.status === UserOnboardingTransitionStatuses.Denied) throw new Error(`user onboarding transition denied: ${result.reason}`);
}

/** Write one bounded onboarding error. */
function _Error(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}

/** Run one chat endpoint with shared session ownership, expected denial, and bounded logging rules. */
async function _ChatRequest(dependencies: UserOnboardingRouterDependencies, request: Request, response: Response, operation: string, action: (owner: UserOnboardingOwner) => Promise<{ readonly status: number; readonly body: unknown }>): Promise<void>
{
	const owner = dependencies.resolveOwner(request);
	if (owner === null) { _Error(response, 401, "onboarding_authentication_required"); return; }
	try
	{
		const result = await action(owner);
		response.status(result.status).json(result.body);
	}
	catch (err)
	{
		if (err instanceof UserOnboardingChatError) { _Error(response, _ChatErrorStatus(err.reason), `onboarding_chat_${err.reason}`); return; }
		dependencies.logger.error({ err, operation, siloId: owner.siloId, subjectId: owner.subjectId }, "User onboarding chat request failed");
		_Error(response, 503, "onboarding_authority_unavailable");
	}
}

/** Map expected chat denials to stable client or service status codes. */
function _ChatErrorStatus(reason: UserOnboardingChatFailureReasons): number
{
	const statuses: Record<UserOnboardingChatFailureReasons, number> = {
		[UserOnboardingChatFailureReasons.NotReady]: 409,
		[UserOnboardingChatFailureReasons.EvidenceUnavailable]: 503,
		[UserOnboardingChatFailureReasons.StateConflict]: 409,
		[UserOnboardingChatFailureReasons.InvalidAnswer]: 400,
		[UserOnboardingChatFailureReasons.InvalidIdempotencyKey]: 400,
		[UserOnboardingChatFailureReasons.InvalidCoordinate]: 400,
		[UserOnboardingChatFailureReasons.NotConcludable]: 409,
	};
	return statuses[reason];
}
