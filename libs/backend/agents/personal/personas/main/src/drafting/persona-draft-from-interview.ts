import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftResult, type PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types";

/**
 * Creates the persona draft the owner reviews before approving it.
 *
 * This is the step between a scored interview and an approved persona. It selects the SOUL template
 * for the owner's resolved colour and modifier, fills the template in from their answers, and stores
 * the result together with three to five insights and every source id and digest it used. Approval
 * later recomputes all of it and refuses if anything no longer matches.
 *
 * The draft can only be created once every tie is broken. If the score still has an open tie the call
 * is refused with `ResolutionRequired`, and the owner must choose first.
 *
 * Called by: the POST /me/persona/interviews/{interviewId}/draft route in
 * persona-onboarding.router.ts. There are no other callers.
 *
 * @param repository - Derives the draft and writes it inside one Serializable transaction.
 * @param command - Silo, owner, profile, the completed interview, and the server timestamp.
 * @returns `Created` with the new revision id, which the owner then reviews. `Denied` with a
 * {@link PersonaDraftDenialReasons}: `ResolutionRequired` means break the remaining tie first,
 * `DerivationMismatch` means the stored score or interpolation map no longer replays and needs an
 * operator, and `Conflict` is retryable. Never throws.
 * @see PersonaDraftFromInterviewRepository
 */
export async function __CreatePersonaDraftFromInterview(repository: PersonaDraftFromInterviewRepository, command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || !command.personaProfileId.trim() || !command.interviewId.trim() || !Number.isFinite(Date.parse(command.authoredAt))) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaDraftDenialReasons.InvalidCommand };
	const result = await repository.createFromInterviewAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Created ? { outcome: PersonaLifecycleOutcomes.Created, personaRevisionId: result.personaRevisionId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}
