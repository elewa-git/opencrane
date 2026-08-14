import { _CreatePersonaWorkflowEvidenceRepository, PersonaWorkflowColours, type PersonaOnboardingCaller, type PersonaOnboardingWorkflowPort, type PersonaWorkflowEvidenceRepository } from "@opencrane/backend/agents/personal/personas";
import type { Logger } from "@opencrane/backend/observability";
import { type UserOnboardingOwner, type UserOnboardingOwnerResolver, type UserOnboardingPersonaEvidencePort, UserOnboardingBootstrapArchetypes, UserOnboardingPersonaColours, __CreateUserOnboardingRouter, __UserOnboardingAuthority, __UserOnboardingChatAuthority, _CreateUserOnboardingRepository, UserOnboardingPersonaWorkflowCoordinator } from "@opencrane/backend/server/agents/onboarding";

import type { UserOnboardingRouteComposition } from "./routes.types";

/** The Prisma client type `_CreateUserOnboardingRepository` expects, derived so this file need not import Prisma. */
type UserOnboardingPrismaClient = Parameters<typeof _CreateUserOnboardingRepository>[0];

/** Compose the complete owner-only onboarding router and its persona notifications. */
export function _CreateUserOnboardingComposition(prisma: UserOnboardingPrismaClient, logger: Logger, resolveOwner: UserOnboardingOwnerResolver): UserOnboardingRouteComposition
{
	const repository = _CreateUserOnboardingRepository(prisma);
	const personaEvidence = _CreateUserOnboardingPersonaEvidence(_CreatePersonaWorkflowEvidenceRepository(prisma));
	const authority = new __UserOnboardingAuthority(repository, personaEvidence, 1);
	const chatAuthority = new __UserOnboardingChatAuthority(authority, repository, personaEvidence);
	return { router: __CreateUserOnboardingRouter({ authority, chatAuthority, resolveOwner, logger }), personaWorkflow: _CreatePersonaOnboardingWorkflow(authority) };
}

/** Compose the app-owned adapter that translates names between the persona and durable onboarding authorities. */
export function _CreatePersonaOnboardingWorkflow(authority: __UserOnboardingAuthority): PersonaOnboardingWorkflowPort
{
	const coordinator = new UserOnboardingPersonaWorkflowCoordinator(authority);
	return {
		surveyStarted(caller, interviewId): Promise<void> { return coordinator.surveyStarted(_WorkflowOwner(caller), interviewId); },
		personaApproved(caller, evidence): Promise<void> { return coordinator.personaApproved(_WorkflowOwner(caller), evidence); },
	};
}

/** Translate persona's owner name into the stable subject fields onboarding expects. */
function _WorkflowOwner(caller: PersonaOnboardingCaller): UserOnboardingOwner
{
	return { siloId: caller.siloId, subjectId: caller.userId };
}

/** Adapt persona's evidence field names without sharing either domain's persistence authority. */
function _CreateUserOnboardingPersonaEvidence(repository: PersonaWorkflowEvidenceRepository): UserOnboardingPersonaEvidencePort
{
	return {
		ownsInterview(owner, interviewId) { return repository.ownsInterview(owner, interviewId); },
		readApprovedPersona(owner, evidence) { return repository.readApprovedPersona(owner, evidence); },
		readLatestApprovedPersona(owner, interviewId) { return repository.readLatestApprovedPersona(owner, interviewId); },
		async readApprovedBootstrapEvidence(owner, personaRevisionId)
		{
			const evidence = await repository.readApprovedBootstrapEvidence(owner, personaRevisionId);
			if (evidence === null) return null;
			const primaryColour = _PersonaColour(evidence.primaryColour);
			return { personaRevisionId: evidence.personaRevisionId, displayName: evidence.displayName, primaryColour, archetype: _Archetype(primaryColour) };
		},
	};
}

/** Map the persona persistence colour names into the public lowercase colour enum. */
function _PersonaColour(colour: PersonaWorkflowColours): UserOnboardingPersonaColours
{
	const colours: Record<PersonaWorkflowColours, UserOnboardingPersonaColours> = { [PersonaWorkflowColours.Red]: UserOnboardingPersonaColours.Red, [PersonaWorkflowColours.Yellow]: UserOnboardingPersonaColours.Yellow, [PersonaWorkflowColours.Green]: UserOnboardingPersonaColours.Green, [PersonaWorkflowColours.Blue]: UserOnboardingPersonaColours.Blue };
	return colours[colour];
}

/** Return the one archetype that an approved persona colour maps to. */
function _Archetype(colour: UserOnboardingPersonaColours): UserOnboardingBootstrapArchetypes
{
	const archetypes: Record<UserOnboardingPersonaColours, UserOnboardingBootstrapArchetypes> = { [UserOnboardingPersonaColours.Red]: UserOnboardingBootstrapArchetypes.Commander, [UserOnboardingPersonaColours.Yellow]: UserOnboardingBootstrapArchetypes.Catalyst, [UserOnboardingPersonaColours.Green]: UserOnboardingBootstrapArchetypes.Anchor, [UserOnboardingPersonaColours.Blue]: UserOnboardingBootstrapArchetypes.Analyst };
	return archetypes[colour];
}
