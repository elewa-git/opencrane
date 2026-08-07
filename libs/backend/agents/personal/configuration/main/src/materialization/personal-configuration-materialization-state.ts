import { PersonalConfigurationMaterializationCodes, type PersonalConfigurationMaterializationPersistenceResult } from "./personal-configuration-materialization.types.js";
import { PersonalConfigurationMaterializationLifecycleOutcomes, PersonalConfigurationMaterializationLifecycleStates, PersonalConfigurationMaterializationResolutionOutcomes, type PersonalConfigurationMaterializationLifecycleChange, type PersonalConfigurationMaterializationLifecycleResult, type PersonalConfigurationMaterializationResolution } from "./personal-configuration-materialization-state.types.js";

/** Select the only permitted next action for a persisted proposal lifecycle state. */
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

/** Wrap a lifecycle terminal result for the state machine boundary. */
function _TerminalLifecycle(result: PersonalConfigurationMaterializationPersistenceResult): PersonalConfigurationMaterializationLifecycleResult
{
	return { outcome: PersonalConfigurationMaterializationLifecycleOutcomes.Terminal, result };
}

/** Wrap a stable persistence result for the materializer's public resolution union. */
export function _TerminalProposalResolution(result: PersonalConfigurationMaterializationPersistenceResult): PersonalConfigurationMaterializationResolution
{
	return { outcome: PersonalConfigurationMaterializationResolutionOutcomes.Terminal, result };
}
