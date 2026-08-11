import { _ParsePersonalConfigurationProposalCommand } from "./personal-configuration-proposal.validator.js";
import type { PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-repository.types.js";
import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand, type ProposePersonalConfigurationChangeResult } from "./personal-configuration-proposal.types.js";

/** Persist a future-snapshot-only personal configuration proposal after strict coordinate validation. */
export async function __ProposePersonalConfigurationChange(repository: PersonalConfigurationProposalRepository, command: ProposePersonalConfigurationChangeCommand): Promise<ProposePersonalConfigurationChangeResult>
{
	// 1. Parse the complete caller-controlled command before persistence can be queried.
	const parsed = _ParsePersonalConfigurationProposalCommand(command);
	if (parsed === null) return _invalidCommand();

	// 2. Insert through the database-guarded transaction authority.
	const receipt = await repository.propose(parsed);
	return _proposed(receipt.changeId);
}

/** Returns the stable denial for caller-controlled evidence outside the closed command model. */
function _invalidCommand(): ProposePersonalConfigurationChangeResult
{
	const result: ProposePersonalConfigurationChangeResult = { outcome: PersonalConfigurationProposalCodes.Denied, reason: PersonalConfigurationProposalCodes.InvalidCommand };
	return result;
}

/** Returns the stable domain result for one durable proposal receipt. */
function _proposed(changeId: string): ProposePersonalConfigurationChangeResult
{
	const result: ProposePersonalConfigurationChangeResult = { outcome: PersonalConfigurationProposalCodes.Proposed, changeId };
	return result;
}
