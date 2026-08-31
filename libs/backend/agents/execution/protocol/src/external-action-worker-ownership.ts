import type { AgentRunExternalActionWorkerInvocation, ExternalActionWorkerInvocation } from "./external-action-worker.types";

/** Return whether the invocation belongs to one exact AgentRun attempt. */
export function _IsAgentRunExternalActionInvocation(invocation: ExternalActionWorkerInvocation): invocation is AgentRunExternalActionWorkerInvocation
{
	return invocation.runId !== null && invocation.attempt !== null && invocation.mcpTaskId === null;
}
