import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type ApprovePersonaResult, type PersonaAuthorityRepository } from "./persona-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Approves and activates a reviewable persona without creating a mutable runtime SOUL file. */
export async function __ApprovePersona(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
{
	// 1. Stable identifiers and a trusted timestamp are required before authority is read.
	if (!command.personaProfileId.trim() || !command.personaRevisionId.trim() || !command.userId.trim() || !Number.isFinite(Date.parse(command.approvedAt)))
	{
		return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.InvalidCommand };
	}

	// 2. Evaluate the complete onboarding evidence from one consistent persistence snapshot.
	const snapshot = await repository.getApprovalSnapshot(command);
	if (snapshot === null) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotFound };
	if (snapshot.profileUserId !== command.userId || snapshot.revisionProfileId !== command.personaProfileId) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.WrongOwner };
	if (snapshot.revisionState !== PersonaApprovalRevisionStates.Draft) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotDraft };
	if (snapshot.interviewState !== PersonaApprovalInterviewStates.Completed) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.InterviewIncomplete };
	if (snapshot.insightCount < 3 || snapshot.insightCount > 5) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.InvalidInsights };
	if (!snapshot.templateDigestMatches) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.TemplateMismatch };
	if (!snapshot.templateSelectionMatches) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.TemplateSelectionMismatch };
	if (snapshot.durableSoulMutationPolicy !== "forbidden") return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.MutableSoulPolicy };

	// 3. Rebind all mutable preconditions at commit so concurrent edits fail closed.
	const result = await repository.approveAndActivateAtomically({ ...command, expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: snapshot.insightCount });
	if (result.status === PersonaApprovalPersistenceStatuses.Approved) return { outcome: PersonaLifecycleOutcomes.Approved };
	if (result.status === PersonaApprovalPersistenceStatuses.NotFound) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotFound };
	return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.Conflict };
}
