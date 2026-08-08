import { Router, type Response } from "express";

import { UserOnboardingTransitionStatuses } from "./user-onboarding.enums.js";
import type { UserOnboardingPersonaWorkflowPort, UserOnboardingRouterDependencies } from "./user-onboarding.http.types.js";
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
