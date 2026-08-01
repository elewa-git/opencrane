import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftResult, type PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types.js";
import { PersonaLifecycleOutcomes } from "../profile/persona-lifecycle.types.js";

/** Create a reviewable persona draft while keeping durable insight wording server-derived. */
export async function __CreatePersonaDraftFromInterview(repository: PersonaDraftFromInterviewRepository, command: Omit<CreatePersonaDraftCommand, "insights">): Promise<CreatePersonaDraftResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || !command.personaProfileId.trim() || !command.interviewId.trim() || !Number.isFinite(Date.parse(command.authoredAt))) return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaDraftDenialReasons.InvalidCommand };
	const result = await repository.createFromInterviewAtomically(command);
	return result.status === PersonaLifecycleOutcomes.Created ? { outcome: PersonaLifecycleOutcomes.Created, personaRevisionId: result.personaRevisionId } : { outcome: PersonaLifecycleOutcomes.Denied, reason: result.status };
}
