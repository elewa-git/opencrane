import type { PersonaRefreshInterviewRepository, StartPersonaRefreshInterviewCommand, StartPersonaRefreshInterviewResult } from "./persona-refresh-interview.types.js";

/** Starts a real reviewed interview for an already-accepted persona refresh. */
export async function __StartPersonaRefreshInterview(repository: PersonaRefreshInterviewRepository, command: StartPersonaRefreshInterviewCommand): Promise<StartPersonaRefreshInterviewResult>
{
	if (!_isValid(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.startRefreshAtomically(command);
	return result.status === "started" || result.status === "already_started" ? { outcome: result.status, interviewId: result.interviewId } : { outcome: "denied", reason: result.status };
}

/** Validates bounded durable coordinates before the configuration journal is read. */
function _isValid(command: StartPersonaRefreshInterviewCommand): boolean
{
	return _identifier(command.siloId) && _identifier(command.userId) && _identifier(command.personaProfileId) && _identifier(command.refreshChangeId) && _identifier(command.questionSetId) && Number.isSafeInteger(command.questionSetVersion) && command.questionSetVersion > 0 && Number.isFinite(Date.parse(command.startedAt));
}

/** Validates an opaque persisted identifier without imposing a hidden format. */
function _identifier(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
