import type { PersonaOnboardingCaller, PersonaOnboardingWorkflowPort } from "@opencrane/backend/agents/personal/personas";
import { type UserOnboardingOwner, __UserOnboardingAuthority, UserOnboardingPersonaWorkflowCoordinator } from "@opencrane/backend/server/agents/onboarding";

/** Compose the app-owned vocabulary adapter between persona and durable onboarding authorities. */
export function _CreatePersonaOnboardingWorkflow(authority: __UserOnboardingAuthority): PersonaOnboardingWorkflowPort
{
	const coordinator = new UserOnboardingPersonaWorkflowCoordinator(authority);
	return {
		surveyStarted(caller, interviewId): Promise<void> { return coordinator.surveyStarted(_WorkflowOwner(caller), interviewId); },
		personaApproved(caller, evidence): Promise<void> { return coordinator.personaApproved(_WorkflowOwner(caller), evidence); },
	};
}

/** Translate persona's owner name to onboarding's stable subject vocabulary. */
function _WorkflowOwner(caller: PersonaOnboardingCaller): UserOnboardingOwner
{
	return { siloId: caller.siloId, subjectId: caller.userId };
}
