import { PersonalConfigurationDecisionCodes, type DecidePersonalConfigurationChangeCommand, type DecidePersonalConfigurationChangeResult, type PersonalConfigurationChangeDecisionRepository } from "./personal-configuration-decision.types";

/**
 * Records the owner's accept-or-reject decision for one proposal.
 *
 * Changes no persona, agent service, run or input snapshot: accepting records consent, and a
 * separate materialisation step is what creates a revision. A caller must not report the agent
 * as changed on the strength of an `Accepted` result.
 *
 * A rejection must carry a reason and an acceptance must not; both are refused as
 * `InvalidCommand` otherwise, so the recorded decision always explains itself.
 *
 * Called by: the decide route handler
 * (`_CreateDecidePersonalConfigurationChangeHandler`).
 *
 * @param repository - Records the decision. See {@link PersonalConfigurationChangeDecisionRepository}.
 * @param command - Server-derived owner, proposal id, decision and time.
 * @returns `Accepted` or `Rejected` when recorded; `Denied` with `InvalidCommand`,
 * `NotFoundOrNotOwner`, `AlreadyDecided` or `PersistenceUnavailable`. Only the last is retryable.
 */
export async function __DecidePersonalConfigurationChange(repository: PersonalConfigurationChangeDecisionRepository, command: DecidePersonalConfigurationChangeCommand): Promise<DecidePersonalConfigurationChangeResult>
{
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.changeId) || Number.isNaN(Date.parse(command.decidedAt)) || (command.decision === PersonalConfigurationDecisionCodes.Accepted && command.rejectionReason !== null) || (command.decision === PersonalConfigurationDecisionCodes.Rejected && !_valid(command.rejectionReason ?? "")))
		return { outcome: PersonalConfigurationDecisionCodes.Denied, reason: PersonalConfigurationDecisionCodes.InvalidCommand };
	const result = await repository.decideAtomically(command);
	return result.status === PersonalConfigurationDecisionCodes.Accepted || result.status === PersonalConfigurationDecisionCodes.Rejected ? { outcome: result.status } : { outcome: PersonalConfigurationDecisionCodes.Denied, reason: result.status };
}

/** Returns whether a value is non-blank and at most 200 characters. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
