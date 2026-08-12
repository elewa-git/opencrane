import { _ApprovalEvidenceDenial, _ApprovePersonaRevisionState } from "./persona-approval-revision-state.js";
import { PersonaApprovalDenialReasons, type ApprovePersonaCommand, type ApprovePersonaResult, type PersonaAuthorityRepository } from "./persona-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/**
 * Approves the owner's persona draft and makes it the profile's active persona.
 *
 * Approval is the last step of persona onboarding: until it succeeds the owner has a draft they can
 * still reject, and no personal agent session can start. It runs in three stages — validate the
 * request, check every precondition against one snapshot, then attempt the update through the
 * revision state. Nothing is written unless every precondition still holds at the update itself, so a
 * second browser tab cannot approve a draft the owner has already replaced.
 *
 * Retrying is safe. If the same revision is already the active one the call reports
 * {@link PersonaLifecycleOutcomes.Approved} again rather than failing.
 *
 * Called by: the POST /me/persona/drafts/{personaRevisionId}/approve route in
 * persona-onboarding.router.ts. There are no other callers.
 *
 * @param repository - Loads the approval snapshot and performs the approve-and-activate update.
 * @param command - The owner, profile, revision, and the server timestamp to record.
 * @returns `Approved` when the revision is now this profile's active persona, whether that happened
 * on this call or an earlier identical one. `Denied` with a {@link PersonaApprovalDenialReasons}
 * saying what the caller must do: `Conflict` is retryable once the owner re-reads their status, while
 * `NotDraft`, `TemplateMismatch`, `TemplateSelectionMismatch` and `MutableSoulPolicy` are not — they
 * need a fresh draft. Never throws; a persistence failure arrives as a `Conflict` denial from the
 * unit of work.
 * @see PersonaAuthorityRepository
 */
export async function __ApprovePersona(repository: PersonaAuthorityRepository, command: ApprovePersonaCommand): Promise<ApprovePersonaResult>
{
	// 1. Require the identifiers and a parseable timestamp before reading anything from the database.
	if (!command.personaProfileId.trim() || !command.personaRevisionId.trim() || !command.userId.trim() || !Number.isFinite(Date.parse(command.approvedAt)))
	{
		return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.InvalidCommand };
	}

	// 2. Check every approval precondition against one snapshot read in a single transaction.
	const snapshot = await repository.getApprovalSnapshot(command);
	if (snapshot === null) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaApprovalDenialReasons.NotFound };
	const denial = _ApprovalEvidenceDenial(snapshot, command);
	if (denial !== null) return { outcome: PersonaLifecycleOutcomes.Denied, reason: denial };
	// 3. Hand off by revision state. Only the draft state runs the compare-and-set and the re-read after losing it.
	return _ApprovePersonaRevisionState(repository, snapshot, command);
}
