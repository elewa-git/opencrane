import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type MaterializePersonalConfigurationChangeResult, type PersonalConfigurationChangeMaterializationRepository } from "./personal-configuration-materialization.types.js";

/** Apply one accepted model-alias proposal to the next immutable personal AgentRevision. */
export async function __MaterializePersonalConfigurationChange(repository: PersonalConfigurationChangeMaterializationRepository, command: MaterializePersonalConfigurationChangeCommand): Promise<MaterializePersonalConfigurationChangeResult>
{
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.changeId) || Number.isNaN(Date.parse(command.materializedAt))) return { outcome: PersonalConfigurationMaterializationCodes.Denied, reason: PersonalConfigurationMaterializationCodes.InvalidCommand };
	const result = await repository.materializeAtomically(command);
	if (result.status === PersonalConfigurationMaterializationCodes.Applied) return { outcome: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: result.agentRevisionId };
	if (result.status === PersonalConfigurationMaterializationCodes.NotApplicable) return { outcome: PersonalConfigurationMaterializationCodes.NotApplicable };
	return { outcome: PersonalConfigurationMaterializationCodes.Denied, reason: result.status };
}

/** Require bounded non-empty durable coordinates before entering the transaction. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
