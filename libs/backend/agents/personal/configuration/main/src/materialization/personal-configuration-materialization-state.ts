import { PersonalConfigurationMaterializationCodes, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { PersonalConfigurationMaterializationLifecycleOutcomes, PersonalConfigurationMaterializationLifecycleStates, PersonalConfigurationMaterializationResolutionOutcomes, type PersonalConfigurationMaterializationLifecycleChange, type PersonalConfigurationMaterializationLifecycleResult, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";

/** Decides from the proposal's state whether to materialise it, or to stop with a result. */
export function _ResolvePersonalConfigurationMaterializationLifecycle(change: PersonalConfigurationMaterializationLifecycleChange): PersonalConfigurationMaterializationLifecycleResult
{
	switch (change.state)
	{
		case PersonalConfigurationMaterializationLifecycleStates.Accepted:
			return { outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Materialize };
		case PersonalConfigurationMaterializationLifecycleStates.Applied:
			return change.appliedAgentRevisionId === null
				? _TerminalLifecycle({ status: PersonalConfigurationMaterializationCodes.NotAccepted })
				: _TerminalLifecycle({ status: PersonalConfigurationMaterializationCodes.Applied, agentRevisionId: change.appliedAgentRevisionId });
		case PersonalConfigurationMaterializationLifecycleStates.Proposed:
		case PersonalConfigurationMaterializationLifecycleStates.Rejected:
		case PersonalConfigurationMaterializationLifecycleStates.Superseded:
			return _TerminalLifecycle({ status: PersonalConfigurationMaterializationCodes.NotAccepted });
		default:
			return _TerminalLifecycle({ status: PersonalConfigurationMaterializationCodes.NotAccepted });
	}
}

/** Wraps a final result so the caller stops instead of materialising. */
function _TerminalLifecycle(result: PersonalConfigurationMaterializationPersistenceResult): PersonalConfigurationMaterializationLifecycleResult
{
	return { outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Terminal, result };
}

/** Wraps a final result as a resolution, telling the materialiser to stop. */
export function _TerminalProposalResolution(result: PersonalConfigurationMaterializationPersistenceResult): PersonalConfigurationMaterializationResolution
{
	return { outcome: PersonalConfigurationMaterializationResolutionOutcomes.Terminal, result };
}
