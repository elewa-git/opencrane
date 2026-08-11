import { _ParsePersonalConfigurationProposalCommand } from "./personal-configuration-proposal.validator.js";
import { PersonalConfigurationProposalCodes, type PersonalConfigurationChangeRepository, type ProposePersonalConfigurationChangeCommand, type ProposePersonalConfigurationChangeResult } from "./personal-configuration-proposal.types.js";

/** Persist a future-snapshot-only personal configuration proposal after strict coordinate validation. */
export async function __ProposePersonalConfigurationChange(repository: PersonalConfigurationChangeRepository, command: ProposePersonalConfigurationChangeCommand): Promise<ProposePersonalConfigurationChangeResult>
{
	// 1. Parse the complete caller-controlled command before persistence can be queried.
	const parsed = _ParsePersonalConfigurationProposalCommand(command);
	if (parsed === null) return { outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand };

	// 2. Insert through one authority transaction so source ownership cannot race a proposal.
	const result = await repository.proposeAtomically(parsed);
	if (result.status === PersonalConfigurationProposalCodes.Proposed) return { outcome: PersonalConfigurationProposalCodes.Proposed, changeId: result.changeId };
	return { outcome: PersonalConfigurationProposalCodes.Denied, reason: result.status };
}
