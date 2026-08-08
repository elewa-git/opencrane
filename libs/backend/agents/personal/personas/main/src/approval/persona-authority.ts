import { PersonaApprovalDenialReasons, PersonaApprovalInterviewStates, PersonaApprovalPersistenceStatuses, PersonaApprovalRevisionStates, type ApprovePersonaCommand, type ApprovePersonaResult, type PersonaApprovalSnapshot, type PersonaAuthorityRepository } from "./persona-authority.types.js";
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
	const denial = _ApprovalEvidenceDenial(snapshot, command);
	if (denial !== null) return { outcome: PersonaLifecycleOutcomes.Denied, reason: denial };
	if (snapshot.revisionState === PersonaApprovalRevisionStates.Approved)
	{
		return snapshot.activeRevisionId === command.personaRevisionId
			? { outcome: PersonaLifecycleOutcomes.Approved }
			: { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotDraft };
	}
	if (snapshot.revisionState !== PersonaApprovalRevisionStates.Draft) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotDraft };

	// 3. Rebind all mutable preconditions at commit so concurrent edits fail closed.
	const result = await repository.approveAndActivateAtomically({ ...command, expectedRevisionState: PersonaApprovalRevisionStates.Draft, expectedInterviewState: PersonaApprovalInterviewStates.Completed, expectedInsightCount: snapshot.insightCount });
	if (result.status === PersonaApprovalPersistenceStatuses.Approved) return { outcome: PersonaLifecycleOutcomes.Approved };
	if (result.status === PersonaApprovalPersistenceStatuses.NotFound) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotFound };
	const reconciled = await repository.getApprovalSnapshot(command);
	if (reconciled !== null && _ApprovalEvidenceDenial(reconciled, command) === null && reconciled.revisionState === PersonaApprovalRevisionStates.Approved && reconciled.activeRevisionId === command.personaRevisionId) return { outcome: PersonaLifecycleOutcomes.Approved };
	return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.Conflict };
}

/** Revalidate immutable owner, interview, insight, and reviewed-source evidence for first approval and retries. */
function _ApprovalEvidenceDenial(snapshot: PersonaApprovalSnapshot, command: ApprovePersonaCommand): PersonaApprovalDenialReasons | null
{
	if (snapshot.profileUserId !== command.userId || snapshot.revisionProfileId !== command.personaProfileId) return PersonaApprovalDenialReasons.WrongOwner;
	if (snapshot.interviewState !== PersonaApprovalInterviewStates.Completed) return PersonaApprovalDenialReasons.InterviewIncomplete;
	if (snapshot.insightCount < 3 || snapshot.insightCount > 5) return PersonaApprovalDenialReasons.InvalidInsights;
	if (!snapshot.templateDigestMatches) return PersonaApprovalDenialReasons.TemplateMismatch;
	if (!snapshot.templateSelectionMatches) return PersonaApprovalDenialReasons.TemplateSelectionMismatch;
	if (snapshot.durableSoulMutationPolicy !== "forbidden") return PersonaApprovalDenialReasons.MutableSoulPolicy;
	return null;
}
