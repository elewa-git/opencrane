import { _ParsePersonalConfigurationProposalCommand } from "./personal-configuration-proposal.validator.js";
import type { PersonalConfigurationProposalRepository } from "./personal-configuration-proposal-repository.types.js";
import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeCommand, type ProposePersonalConfigurationChangeResult } from "./personal-configuration-proposal.types.js";

/**
 * Validates a requested configuration change and records it for the user to decide later.
 *
 * Nothing about the agent changes here, and the run that asked for the change is unaffected —
 * it keeps the input snapshot it was admitted with. Validation happens before any query, so a
 * malformed command never reaches the database, and the digest is recomputed from the patch so
 * a caller cannot record a digest that does not match what it asked for.
 *
 * Called by: {@link PrismaUpgradeSessionProposalRepository.proposeUpgradeSession}, when an agent
 * calls the `upgrade_session` tool.
 *
 * @param repository - Re-checks ownership and inserts, in one transaction.
 * @param command - The request to record.
 * @returns `Proposed` with the new `changeId`; `Denied` with `InvalidCommand` when the command
 * is malformed, `ProvenanceConflict` when the sources are not this user's or a revision moved
 * on, or `PersistenceUnavailable` when the write failed. Only the last is worth retrying.
 */
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
