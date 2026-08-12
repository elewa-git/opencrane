import { PersonalConfigurationMaterializationCodes, type MaterializePersonalConfigurationChangeCommand, type MaterializePersonalConfigurationChangeResult, type PersonalConfigurationChangeMaterializationRepository } from "./personal-configuration-materialization.types.js";

/**
 * Applies one accepted proposal, creating a new immutable personal AgentRevision.
 *
 * Runs already in flight keep the snapshot they were admitted with, so this never changes a
 * conversation that is already executing — only later runs pick up the new revision.
 *
 * Safe to call twice: a proposal that was already applied returns `Applied` with the revision
 * it produced the first time rather than creating a second one.
 *
 * Called by: the materialize route handler
 * (`_CreateMaterializePersonalConfigurationChangeHandler`).
 *
 * @param repository - Drives the cross-domain transaction. See {@link _PersonalConfigurationMaterializer}.
 * @param command - Server-derived owner, proposal id and time.
 * @returns `Applied` with the new `agentRevisionId`; `NotApplicable` when the accepted proposal
 * is a persona refresh, which is not a failure; or `Denied`, of which only
 * `PersistenceUnavailable` is worth retrying. See {@link PersonalConfigurationMaterializationCodes}.
 */
export async function __MaterializePersonalConfigurationChange(repository: PersonalConfigurationChangeMaterializationRepository, command: MaterializePersonalConfigurationChangeCommand): Promise<MaterializePersonalConfigurationChangeResult>
{
	if (!_valid(command.siloId) || !_valid(command.userId) || !_valid(command.changeId) || Number.isNaN(Date.parse(command.materializedAt))) return { outcome: PersonalConfigurationMaterializationCodes.Denied, reason: PersonalConfigurationMaterializationCodes.InvalidCommand };
	const result = await repository.materializeAtomically(command);
	if (result.status === PersonalConfigurationMaterializationCodes.Applied) return { outcome: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: result.agentRevisionId };
	if (result.status === PersonalConfigurationMaterializationCodes.NotApplicable) return { outcome: PersonalConfigurationMaterializationCodes.NotApplicable };
	return { outcome: PersonalConfigurationMaterializationCodes.Denied, reason: result.status };
}

/** Returns whether a value is non-blank and at most 200 characters. */
function _valid(value: string): boolean
{
	return value.trim().length > 0 && value.length <= 200;
}
