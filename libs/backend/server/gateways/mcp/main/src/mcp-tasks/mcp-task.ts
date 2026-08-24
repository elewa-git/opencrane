import { createHash } from "node:crypto";

import { WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { McpTaskEvents, McpTaskStates, McpTaskTaskNames } from "./mcp-task.types";
import type { McpTaskAdmission, McpTaskInputResponse, McpTaskRecord, McpTaskWorkflow, McpTaskWorkflowInput, McpTaskWorkflowOptions } from "./mcp-task.types";

/** Run persistence work again when a transient database failure interrupts the task. */
async function _RetryablePersistence<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
			throw error;
		throw new WorkflowTaskRetryableError("MCP task persistence is temporarily unavailable.");
	}
}

/** Load the exact product task named by the saved workflow input. */
async function _Load(options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskRecord>
{
	return await _RetryablePersistence(async function _LoadWithRetry(): Promise<McpTaskRecord>
	{
		return await options.unitOfWork.execute(async function _LoadTask(transaction): Promise<McpTaskRecord>
		{
			const task = await transaction.mcpTasks.load(input.siloId, input.mcpTaskId, input.callDigest);
			if (task === null)
				throw new WorkflowTaskTerminalError("MCP task is unavailable.");
			return task;
		});
	});
}

/** Move a newly running task into the client-visible input-required state. */
async function _RecordInputRequired(options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskRecord>
{
	return await _RetryablePersistence(async function _RecordInputRequiredWithRetry(): Promise<McpTaskRecord>
	{
		return await options.unitOfWork.execute(async function _StoreInputRequired(transaction): Promise<McpTaskRecord>
		{
			const task = await transaction.mcpTasks.recordInputRequired(input.siloId, input.mcpTaskId, input.callDigest);
			if (task === null)
				throw new WorkflowTaskTerminalError("MCP task is unavailable.");
			return task;
		});
	});
}

/** Store the one bounded result returned by this first MCP task lifecycle. */
async function _RecordCompleted(options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput, response: McpTaskInputResponse): Promise<string>
{
	return await _RetryablePersistence(async function _RecordCompletedWithRetry(): Promise<string>
	{
		return await options.unitOfWork.execute(async function _StoreCompleted(transaction): Promise<string>
		{
			const task = await transaction.mcpTasks.recordCompleted(input.siloId, input.mcpTaskId, input.callDigest, response.value);
			if (task === null || task.result === null)
				throw new WorkflowTaskTerminalError("MCP task result is unavailable.");
			return task.result;
		});
	});
}

/** Derive the event name without placing a product identifier in engine logs. */
function _InputEventName(input: McpTaskWorkflowInput): string
{
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.mcpTaskId, input.callDigest, McpTaskEvents.InputSubmitted])).digest("hex");
	return `workflows:mcp-task-input:${digest}`;
}

/** Wait for client input and save its exact bounded response once. */
async function _Run(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<string>
{
	const task = await _Load(options, input);
	if (task.state === McpTaskStates.Completed)
	{
		if (task.result === null)
			throw new WorkflowTaskTerminalError("Completed MCP task has no result.");
		return task.result;
	}
	if (task.state === McpTaskStates.Cancelled || task.state === McpTaskStates.Failed)
		throw new WorkflowTaskTerminalError("MCP task cannot continue.");
	const waiting = await context.checkpoint({ stepName: "request-input" }, async function _RequestInput(): Promise<McpTaskRecord>
	{
		return await _RecordInputRequired(options, input);
	});
	if (waiting.inputResponse !== null)
		return await _RecordCompleted(options, input, waiting.inputResponse);
	const event = await context.waitForEvent<McpTaskInputResponse>(_InputEventName(input));
	return await context.checkpoint({ stepName: "store-input-result" }, async function _StoreInputResult(): Promise<string>
	{
		return await _RecordCompleted(options, input, event.payload);
	});
}

/** Derive a stable workflow key without exposing MCP call values in engine logs. */
export function __McpTaskWorkflowKey(input: McpTaskWorkflowInput): string
{
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.mcpTaskId, input.callDigest])).digest("hex");
	return `workflows:mcp-task:${digest}`;
}

/** Return the engine event name used when a client submits an input response. */
export function __McpTaskInputEventName(input: McpTaskWorkflowInput): string
{
	return _InputEventName(input);
}

/** Register the saved MCP task lifecycle and return its transaction-bound admission API. */
export function __CreateMcpTaskWorkflow(options: McpTaskWorkflowOptions): McpTaskWorkflow
{
	options.execution.register({
		taskName: McpTaskTaskNames.Call,
		async run(context: IWorkflowTaskContext, input: McpTaskWorkflowInput): Promise<string>
		{
			return await _Run(context, options, input);
		},
	});
	return {
		async admit(transaction: IWorkflowTransaction, input: McpTaskWorkflowInput): Promise<McpTaskAdmission>
		{
			const taskKey = __McpTaskWorkflowKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: McpTaskTaskNames.Call, idempotencyKey: taskKey, input });
			return { receipt, taskKey };
		},
		async deliverInput(task, input, response): Promise<void>
		{
			await options.execution.emitEvent(task, { eventName: _InputEventName(input), payload: response });
		},
	};
}
