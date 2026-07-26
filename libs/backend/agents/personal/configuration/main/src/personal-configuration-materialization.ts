import type { MaterializePersonalConfigurationChangeCommand, MaterializePersonalConfigurationChangeResult, PersonalConfigurationChangeMaterializationRepository } from "./personal-configuration-materialization.types.js";

/** Apply one accepted model-alias proposal to the next immutable personal AgentRevision. */
export async function __MaterializePersonalConfigurationChange(repository: PersonalConfigurationChangeMaterializationRepository, command: MaterializePersonalConfigurationChangeCommand): Promise<MaterializePersonalConfigurationChangeResult>
{
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.changeId) || Number.isNaN(Date.parse(command.materializedAt))) return { outcome: "denied", reason: "invalid_command" };
	const result = await repository.materializeAtomically(command);
	if (result.status === "applied") return { outcome: "applied", agentRevisionId: result.agentRevisionId };
	if (result.status === "not_applicable") return { outcome: "not_applicable" };
	return { outcome: "denied", reason: result.status };
}

/** Require bounded non-empty durable coordinates before entering the transaction. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
