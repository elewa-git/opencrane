import type { CreatePersonaDraftCommand, CreatePersonaDraftResult, PersonaDraftFromInterviewRepository } from "./persona-draft-authority.types.js";

/** Create a reviewable persona draft while keeping durable insight wording server-derived. */
export async function __CreatePersonaDraftFromInterview(repository: PersonaDraftFromInterviewRepository, command: Omit<CreatePersonaDraftCommand, "insights">): Promise<CreatePersonaDraftResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || !command.personaProfileId.trim() || !command.interviewId.trim() || !Number.isFinite(Date.parse(command.authoredAt))) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.createFromInterviewAtomically(command);
	return result.status === "created" ? { outcome: "created", personaRevisionId: result.personaRevisionId } : { outcome: "denied", reason: result.status };
}
