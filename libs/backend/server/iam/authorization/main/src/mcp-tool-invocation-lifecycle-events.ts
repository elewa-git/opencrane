import { TOOL_INVOCATION_PREPARATION_POLICY } from "./tool-invocation-lifecycle.types";
import { ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults } from "./tool-invocation.types";
import type { ToolInvocationLifecycleEvent, ToolInvocationLifecycleEventSink, ToolInvocationRecord, ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink, ToolInvocationRunRecoveryAuthority, ToolInvocationRunRecoveryEnterResult } from "./tool-invocation.types";

/** Exact database transaction type accepted by the runs-owned event writer. */
type _Transaction = Parameters<ToolInvocationLifecycleEventSink["appendInTransaction"]>[0];

/** Failure code stored when the companion cannot prove what the MCP server did. */
export const _MCP_AMBIGUOUS_FAILURE_CODE = "external_action_provider_outcome_ambiguous";

/** Builds the canonical timeline event after a checked MCP tool result succeeds. */
function _CompletedEvent(invocation: ToolInvocationRecord): ToolInvocationLifecycleEvent
{
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: invocation.toolInvocationId } };
}

/** Builds the canonical timeline event after a definite or uncertain MCP tool failure. */
function _FailedEvent(invocation: ToolInvocationRecord, reason: string, retrying: boolean): ToolInvocationLifecycleEvent
{
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, reason, retryCount: invocation.preparationAttempt, retryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, retrying } };
}

/** Appends an event, or aborts the caller's transaction when the owning run rejects it. */
async function _AppendLifecycleEvent(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, event: ToolInvocationLifecycleEvent): Promise<void>
{
	if (!await sink.appendInTransaction(transaction, event))
		throw new Error("tool invocation transition requires its canonical lifecycle event");
}

/** Writes the successful terminal event in the same transaction as result delivery. */
export async function _AppendMcpToolInvocationCompleted(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, invocation: ToolInvocationRecord): Promise<void>
{
	await _AppendLifecycleEvent(sink, transaction, _CompletedEvent(invocation));
}

/** Writes the failed terminal or retry event in the same transaction as its state transition. */
export async function _AppendMcpToolInvocationFailed(sink: ToolInvocationLifecycleEventSink, transaction: _Transaction, invocation: ToolInvocationRecord, reason: string, retrying: boolean): Promise<void>
{
	await _AppendLifecycleEvent(sink, transaction, _FailedEvent(invocation, reason, retrying));
}

/** Builds the run-owned recovery event for an outcome the companion cannot prove. */
function _RecoveryEvent(invocation: ToolInvocationRecord): ToolInvocationRecoveryEvent
{
	return { runId: invocation.runId, expectedAttempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, preparationRetryCount: invocation.preparationAttempt, preparationRetryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, providerOutcome: "unknown_after_dispatch" };
}

/** Moves a run into recovery and commits the matching recovery event in the same transaction. */
export async function _EnterMcpToolInvocationRecovery(authority: ToolInvocationRunRecoveryAuthority, sink: ToolInvocationRecoveryEventSink, transaction: _Transaction, invocation: ToolInvocationRecord): Promise<void>
{
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
