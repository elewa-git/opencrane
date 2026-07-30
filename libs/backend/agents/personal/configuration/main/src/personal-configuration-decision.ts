import { PersonalConfigurationDecisionCodes, type DecidePersonalConfigurationChangeCommand, type DecidePersonalConfigurationChangeResult, type PersonalConfigurationChangeDecisionRepository } from "./personal-configuration.types.js";

/** Record an owner's explicit decision without changing any persona, service, run, or snapshot. */
export async function __DecidePersonalConfigurationChange(repository: PersonalConfigurationChangeDecisionRepository, command: DecidePersonalConfigurationChangeCommand): Promise<DecidePersonalConfigurationChangeResult>
{
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.changeId) || Number.isNaN(Date.parse(command.decidedAt)) || (command.decision === PersonalConfigurationDecisionCodes.Accepted && command.rejectionReason !== null) || (command.decision === PersonalConfigurationDecisionCodes.Rejected && !_valid(command.rejectionReason ?? "")))
		return { outcome: PersonalConfigurationDecisionCodes.Denied, reason: PersonalConfigurationDecisionCodes.InvalidCommand };
	const result = await repository.decideAtomically(command);
	return result.status === PersonalConfigurationDecisionCodes.Accepted || result.status === PersonalConfigurationDecisionCodes.Rejected ? { outcome: result.status } : { outcome: PersonalConfigurationDecisionCodes.Denied, reason: result.status };
}

/** Require a bounded non-empty caller-controlled coordinate or rejection explanation. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
