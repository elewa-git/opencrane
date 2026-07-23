import type { ApprovePersonaRefreshCommand, ApprovePersonaRefreshResult, PersonaRefreshApprovalRepository } from "./persona-refresh-interview.types.js";

/** Approves a refresh-derived persona only with its matching active personal AgentRevision rollover. */
export async function __ApprovePersonaRefresh(repository: PersonaRefreshApprovalRepository, command: ApprovePersonaRefreshCommand): Promise<ApprovePersonaRefreshResult>
{
	if (!_valid(command)) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.approveRefreshAtomically(command);
	return result.status === "approved" ? { outcome: "approved", agentRevisionId: result.agentRevisionId } : { outcome: "denied", reason: result.status };
}

/** Validates durable coordinates before the atomic approval boundary starts. */
function _valid(command: ApprovePersonaRefreshCommand): boolean
{
	return [command.siloId, command.userId, command.personaProfileId, command.personaRevisionId].every(function _identifier(value) { return value.trim().length > 0 && value.length <= 200; }) && Number.isFinite(Date.parse(command.approvedAt));
}
