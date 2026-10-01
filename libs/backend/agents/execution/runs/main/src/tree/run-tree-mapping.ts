import type { RunTreeResources } from "./run-tree.types";

/** Initializes both sides of an allocation; SQL alone changes available values afterwards. */
export function _RunTreeAllocation(resources: RunTreeResources)
{
	return {
		allocatedModelCalls: resources.modelCalls,
		allocatedCompletionTokens: resources.completionTokens,
		allocatedToolInvocations: resources.toolInvocations,
		allocatedLoopIterations: resources.loopIterations,
		allocatedCostMicros: resources.costMicros,
		availableModelCalls: resources.modelCalls,
		availableCompletionTokens: resources.completionTokens,
		availableToolInvocations: resources.toolInvocations,
		availableLoopIterations: resources.loopIterations,
		availableCostMicros: resources.costMicros,
	};
}
