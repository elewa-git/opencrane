import { _ApprovalEvidenceDenial, _ApprovePersonaRevisionState } from "./persona-approval-revision-state.js";
import { PersonaApprovalDenialReasons, type ApprovePersonaCommand, type ApprovePersonaResult, type PersonaAuthorityRepository } from "./persona-authority.types.js";
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
	// 3. State dispatch retains the CAS and conflict re-read in the only revision state that may mutate.
	return _ApprovePersonaRevisionState(repository, snapshot, command);
}
