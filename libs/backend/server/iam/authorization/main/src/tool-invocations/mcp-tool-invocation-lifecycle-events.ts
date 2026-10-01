import { TOOL_INVOCATION_PREPARATION_POLICY } from "./tool-invocation-lifecycle.types";
import { ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults } from "./tool-invocation.types";
import type { ToolInvocationLifecycleEvent, ToolInvocationLifecycleEventSink, ToolInvocationRecord, ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink, ToolInvocationRunRecoveryAuthority, ToolInvocationRunRecoveryEnterResult } from "./tool-invocation.types";

/** Transaction type accepted by the AgentRun event writer. */
type _Transaction = Parameters<ToolInvocationLifecycleEventSink["appendInTransaction"]>[0];

/** Failure code stored when the companion cannot prove what the MCP server did. */
export const _MCP_AMBIGUOUS_FAILURE_CODE = "external_action_provider_outcome_ambiguous";

/** Builds an AgentRun timeline event after a checked MCP result succeeds. */
function _CompletedEvent(invocation: ToolInvocationRecord): ToolInvocationLifecycleEvent
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool completion requires a run owner");
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: invocation.toolInvocationId } };
}

/** Builds an AgentRun timeline event after a definite or uncertain MCP failure. */
function _FailedEvent(invocation: ToolInvocationRecord, reason: string, retrying: boolean): ToolInvocationLifecycleEvent
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool failure requires a run owner");
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, reason, retryCount: invocation.preparationAttempt, retryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, retrying } };
}

/** Builds an AgentRun recovery event for an MCP outcome the companion cannot prove. */
function _RecoveryEvent(invocation: ToolInvocationRecord): ToolInvocationRecoveryEvent
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool recovery event requires a run owner");
	return { runId: invocation.runId, expectedAttempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, preparationRetryCount: invocation.preparationAttempt, preparationRetryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, providerOutcome: "unknown_after_dispatch" };
}

/** Appends an AgentRun event or aborts the transaction when the run rejects it. */
async function _AppendLifecycleEvent(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, event: ToolInvocationLifecycleEvent): Promise<void>
{
	if (!await sink.appendInTransaction(transaction, event))
		throw new Error("tool invocation transition requires its canonical lifecycle event");
}

/** Writes a successful AgentRun event in the same transaction as result delivery. */
export async function _AppendMcpToolInvocationCompleted(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, invocation: ToolInvocationRecord): Promise<void>
{
	await _AppendLifecycleEvent(sink, transaction, _CompletedEvent(invocation));
}

/** Writes a failed or retrying AgentRun event in the same transaction as its state change. */
export async function _AppendMcpToolInvocationFailed(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, invocation: ToolInvocationRecord, reason: string, retrying: boolean): Promise<void>
{
	await _AppendLifecycleEvent(sink, transaction, _FailedEvent(invocation, reason, retrying));
}

/** Moves an AgentRun into recovery and writes its matching event in the same transaction. */
export async function _EnterMcpToolInvocationRecovery(authority: ToolInvocationRunRecoveryAuthority, sink: ToolInvocationRecoveryEventSink, transaction: _Transaction, invocation: ToolInvocationRecord): Promise<void>
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool recovery requires a run owner");
	const outcome: ToolInvocationRunRecoveryEnterResult = await authority.enterRecoveryRequiredInTransaction(transaction, { runId: invocation.runId, attempt: invocation.attempt });
	if (outcome === ToolInvocationRunRecoveryEnterResults.Entered || outcome === ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired)
	{
		if (!await sink.appendInTransaction(transaction, _RecoveryEvent(invocation)))
			throw new Error("tool recovery state requires its canonical recovery event");
		return;
	}
	if (outcome === ToolInvocationRunRecoveryEnterResults.Cancelling)
		return;
	throw new Error("tool recovery state conflicts with its owning run attempt");
}
