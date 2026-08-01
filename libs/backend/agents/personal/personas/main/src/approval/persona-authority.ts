import type { ApprovePersonaCommand, ApprovePersonaResult, PersonaAuthorityRepository } from "./persona-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Approves and activates a reviewable persona without creating a mutable runtime SOUL file. */
export async function __ApprovePersona(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
{
	// 1. Stable identifiers and a trusted timestamp are required before authority is read.
	if (!command.personaProfileId.trim() || !command.personaRevisionId.trim() || !command.userId.trim() || !Number.isFinite(Date.parse(command.approvedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 2. Evaluate the complete onboarding evidence from one consistent persistence snapshot.
	const snapshot = await repository.getApprovalSnapshot(command);
	if (snapshot === null) return { outcome: "denied", reason: "not_found" };
	if (snapshot.profileUserId !== command.userId || snapshot.revisionProfileId !== command.personaProfileId) return { outcome: "denied", reason: "wrong_owner" };
	if (snapshot.revisionState !== "draft") return { outcome: "denied", reason: "not_draft" };
	if (snapshot.interviewState !== "completed") return { outcome: "denied", reason: "interview_incomplete" };
	if (snapshot.insightCount < 3 || snapshot.insightCount > 5) return { outcome: "denied", reason: "invalid_insights" };
	if (!snapshot.templateDigestMatches) return { outcome: "denied", reason: "template_mismatch" };
	if (!snapshot.templateSelectionMatches) return { outcome: "denied", reason: "template_selection_mismatch" };
	if (snapshot.durableSoulMutationPolicy !== "forbidden") return { outcome: "denied", reason: "mutable_soul_policy" };

	// 3. Rebind all mutable preconditions at commit so concurrent edits fail closed.
	const result = await repository.approveAndActivateAtomically({ ...command, expectedRevisionState: "draft", expectedInterviewState: "completed", expectedInsightCount: snapshot.insightCount });
	return result.status === PersonaLifecycleOutcomes.Approved ? { outcome: PersonaLifecycleOutcomes.Approved } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status === PersonaLifecycleOutcomes.NotFound ? PersonaLifecycleOutcomes.NotFound : "conflict" };
}
