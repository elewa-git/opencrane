import { ExternalActionClaimKind, McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, McpTaskState, Prisma, ToolInvocationState } from "@prisma/client";

import { ExternalActionClaimKinds, ToolInvocationStates, type McpToolInvocationTransactionParticipant, type ToolInvocationClaim } from "@opencrane/backend/server/iam/authorization";

import { _McpTerminalWorkloadState } from "../runtime/mcp-runtime-terminal-workload-state";
import { McpTaskStates, type McpTaskWorkflowExhaustionRepository, type McpTaskWorkflowInput, type McpTaskWorkflowResult } from "./mcp-task.types";

/** Failure code shared by the task, invocation, and runtime execution. */
const _FAILURE_CODE = "workflow_attempts_exhausted";

/** Task row and its complete one-to-one execution aggregate. */
type _TaskAggregate = Prisma.McpTaskGetPayload<{ include: { toolInvocation: { include: { mcpRuntimeExecution: true } } } }>;

/** Terminal persistence states and the workflow result exposed for each one. */
const _TERMINAL_STATES: Readonly<Partial<Record<McpTaskState, McpTaskWorkflowResult["state"]>>> = {
	[McpTaskState.Completed]: McpTaskStates.Completed,
	[McpTaskState.Cancelled]: McpTaskStates.Cancelled,
	[McpTaskState.Failed]: McpTaskStates.Failed,
	[McpTaskState.RecoveryRequired]: McpTaskStates.RecoveryRequired,
};

/**
 * Closes the database rows linked to an MCP task after the workflow engine uses its final attempt.
 *
 * Provider-free work fails. A saved provider dispatch becomes `RecoveryRequired`. If an execution
 * has a Kubernetes Job UID, the execution closes in the database so the controller can claim and
 * delete that UID before recording cleanup. A missing or changed fence returns `null` instead of
 * claiming a terminal result.
 *
 * Called by: {@link PrismaMcpRuntimeUnitOfWork.recordWorkflowExhaustion}.
 */
export class PrismaMcpTaskWorkflowExhaustionRepository implements McpTaskWorkflowExhaustionRepository
{
	/** Prisma client for the MCP runtime's open serializable transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization-owned writes bound to the same transaction. */
	private readonly _toolInvocations: McpToolInvocationTransactionParticipant;

	/** Bind aggregate reconciliation to the transaction opened by the MCP runtime authority. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: McpToolInvocationTransactionParticipant)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
	}

	/** Return the saved terminal result, or `null` when the task aggregate no longer matches the workflow input. */
	async record(input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: input.mcpTaskId, siloId: input.siloId, callDigest: input.callDigest }, include: { toolInvocation: { include: { mcpRuntimeExecution: true } } } });
		if (task === null)
			return null;
		const terminal = _TerminalResult(task);
		if (terminal !== null)
			return terminal;
		const now = await this._databaseNow();
		if (task.state === McpTaskState.Working || task.state === McpTaskState.InputRequired)
			return this._closeBeforeInvocation(task, now);
		if (task.state === McpTaskState.Queued)
			return this._closeBeforeDispatch(task, now);
		if (task.state === McpTaskState.Running)
			return this._closeAfterDispatch(task, now);
		return null;
	}

	/** Fail a task that never created an authorization-owned invocation. */
	private async _closeBeforeInvocation(task: _TaskAggregate, now: Date): Promise<McpTaskWorkflowResult | null>
	{
		if (task.toolInvocation !== null)
			return null;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: task.id, siloId: task.siloId, callDigest: task.callDigest, state: task.state, toolInvocation: { is: null } }, data: { state: McpTaskState.Failed, failureCode: _FAILURE_CODE, completedAt: now } });
		return updated.count === 1 ? { mcpTaskId: task.id, state: McpTaskStates.Failed } : null;
	}

	/** Fail exact Ready work and close an optional execution before provider dispatch. */
	private async _closeBeforeDispatch(task: _TaskAggregate, now: Date): Promise<McpTaskWorkflowResult | null>
	{
		const invocation = task.toolInvocation;
		const execution = invocation?.mcpRuntimeExecution ?? null;
		if (invocation === null || invocation.state !== ToolInvocationState.Ready || invocation.claimKind !== null || invocation.claimExpiresAt !== null)
			return null;
		const workloadState = execution === null ? null : _McpTerminalWorkloadState(execution, McpExecutorWorkloadState);
		if (execution !== null && (execution.siloId !== task.siloId || execution.kind !== McpRuntimeExecutionKind.Invocation || execution.commandState !== McpExecutorCommandState.Pending || workloadState === null || execution.toolInvocationId !== invocation.id || execution.companionClaimFence !== null || execution.toolInvocationClaimFence !== null || execution.toolInvocationClaimRevision !== null))
			return null;
		const closed = await this._toolInvocations.completeUnusedBeforeDispatch(invocation.id, invocation.revision, _FAILURE_CODE, now);
		if (!closed.changed || closed.invocation?.state !== ToolInvocationStates.Failed || closed.invocation.failureCode !== _FAILURE_CODE)
			return null;
		if (execution !== null)
		{
			const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, siloId: task.siloId, toolInvocationId: invocation.id, kind: McpRuntimeExecutionKind.Invocation, workloadState: execution.workloadState, commandState: McpExecutorCommandState.Pending, workloadUid: execution.workloadUid, claimedAt: execution.claimedAt, claimExpiresAt: execution.claimExpiresAt, deliveryCount: execution.deliveryCount, companionClaimFence: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null }, data: { workloadState: workloadState as McpExecutorWorkloadState, commandState: McpExecutorCommandState.Failed, terminalOutcome: _FAILURE_CODE, completedAt: now } });
			if (updated.count !== 1)
				throw new Error("exhausted MCP task lost its pre-dispatch runtime fence");
		}
		return { mcpTaskId: task.id, state: McpTaskStates.Failed };
	}

	/** Preserve uncertainty after dispatch and close every row under its saved claim fence. */
	private async _closeAfterDispatch(task: _TaskAggregate, now: Date): Promise<McpTaskWorkflowResult | null>
	{
		const invocation = task.toolInvocation;
		const execution = invocation?.mcpRuntimeExecution ?? null;
		if (invocation === null || execution === null || invocation.state !== ToolInvocationState.Claimed || invocation.claimKind !== ExternalActionClaimKind.Dispatch || execution.siloId !== task.siloId || execution.kind !== McpRuntimeExecutionKind.Invocation || execution.workloadState !== McpExecutorWorkloadState.Registered || execution.commandState !== McpExecutorCommandState.Claimed || execution.toolInvocationId !== invocation.id || execution.toolInvocationClaimFence !== invocation.claimFence || execution.toolInvocationClaimRevision !== invocation.revision || execution.companionClaimFence === null)
			return null;
		const claim: ToolInvocationClaim = { invocationId: invocation.id, kind: ExternalActionClaimKinds.Dispatch, fence: invocation.claimFence, revision: invocation.revision };
		const recovered = await this._toolInvocations.completeAmbiguous(claim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			throw new Error("exhausted MCP task could not preserve its dispatched outcome");
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, siloId: task.siloId, toolInvocationId: invocation.id, kind: McpRuntimeExecutionKind.Invocation, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Claimed, companionClaimFence: execution.companionClaimFence, toolInvocationClaimFence: invocation.claimFence, toolInvocationClaimRevision: invocation.revision }, data: { workloadState: McpExecutorWorkloadState.Closed, commandState: McpExecutorCommandState.RecoveryRequired, terminalOutcome: _FAILURE_CODE, completedAt: now } });
		if (updated.count !== 1)
			throw new Error("exhausted MCP task lost its dispatched runtime fence");
		return { mcpTaskId: task.id, state: McpTaskStates.RecoveryRequired };
	}

	/** Read the database clock used by every runtime fence in this transaction. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("MCP runtime database clock unavailable");
		return clock.now;
	}
}

/** Return the stable workflow result for a task that another actor already closed. */
function _TerminalResult(task: Pick<_TaskAggregate, "id" | "state">): McpTaskWorkflowResult | null
{
	const state = _TERMINAL_STATES[task.state];
	return state === undefined ? null : { mcpTaskId: task.id, state };
}
