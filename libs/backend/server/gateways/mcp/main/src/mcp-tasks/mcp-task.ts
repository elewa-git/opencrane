import { createHash } from "node:crypto";

import { WorkflowTaskRetryBackoffKinds, WorkflowTaskRetryableError, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { McpTaskEvents, McpTaskStates, McpTaskTaskNames } from "./mcp-task.types";
import type { McpTaskAdmission, McpTaskInputResponse, McpTaskRecord, McpTaskWorkflow, McpTaskWorkflowInput, McpTaskWorkflowOptions, McpTaskWorkflowResult } from "./mcp-task.types";

/** Terminal task states the Absurd handler may return. */
const _TERMINAL_STATES = new Set<McpTaskStates>([McpTaskStates.Completed, McpTaskStates.Cancelled, McpTaskStates.Failed, McpTaskStates.RecoveryRequired]);

/** Turn unknown database failures into declared workflow retries. */
async function _Retryable<TResult>(operation: () => Promise<TResult>): Promise<TResult>
{
	try
	{
		return await operation();
	}
	catch (error)
	{
		if (error instanceof WorkflowTaskRetryableError || error instanceof WorkflowTaskTerminalError)
			throw error;
		throw new WorkflowTaskRetryableError("MCP task persistence is temporarily unavailable");
	}
}

/** Load the exact task bound into the saved workflow input. */
async function _Load(options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskRecord>
{
	return _Retryable(async function _LoadTask(): Promise<McpTaskRecord>
	{
		return options.unitOfWork.execute(async function _Read(transaction): Promise<McpTaskRecord>
		{
			const task = await transaction.mcpTasks.load(input.siloId, input.mcpTaskId, input.callDigest);
			if (task === null)
				throw new WorkflowTaskTerminalError("MCP task is unavailable");
			return task;
		});
	});
}

/** Convert a saved terminal state into the bounded workflow result. */
function _Terminal(task: McpTaskRecord): McpTaskWorkflowResult | null
{
	if (!_TERMINAL_STATES.has(task.state))
		return null;
	return { mcpTaskId: task.id, state: task.state as McpTaskWorkflowResult["state"] };
}

/** Wait for one saved response when the task declared an input request. */
async function _AwaitInput(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput, task: McpTaskRecord): Promise<McpTaskRecord>
{
	if (task.inputRequest === null || task.inputResponse !== null)
		return task;
	const waiting = await context.checkpoint({ stepName: "request-input" }, async function _RequestInput(): Promise<McpTaskRecord>
	{
		return _Retryable(async function _RecordWaiting(): Promise<McpTaskRecord>
		{
			return options.unitOfWork.execute(async function _Write(transaction): Promise<McpTaskRecord>
			{
				const saved = await transaction.mcpTasks.recordInputRequired(input.siloId, input.mcpTaskId, input.callDigest);
				if (saved === null)
					throw new WorkflowTaskTerminalError("MCP task input request is unavailable");
				return saved;
			});
		});
	});
	if (waiting.inputResponse !== null || _Terminal(waiting) !== null)
		return waiting;
	await context.waitForEvent<McpTaskInputResponse>(_InputEventName(input));
	return _Load(options, input);
}

/** Admit the mutually exclusive task-owned ToolInvocation once. */
async function _AdmitToolInvocation(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskRecord>
{
	return context.checkpoint({ stepName: "admit-tool-invocation" }, async function _Admit(): Promise<McpTaskRecord>
	{
		return _Retryable(async function _WriteInvocation(): Promise<McpTaskRecord>
		{
			return options.unitOfWork.execute(async function _Write(transaction): Promise<McpTaskRecord>
			{
				const task = await transaction.mcpTasks.admitToolInvocation(input.siloId, input.mcpTaskId, input.callDigest);
				if (task === null)
					throw new WorkflowTaskTerminalError("MCP task tool invocation is unavailable");
				return task;
			});
		});
	});
}

/** Admit the task-owned ToolInvocation into the existing OCI runtime execution authority. */
async function _AdmitRuntime(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput, task: McpTaskRecord): Promise<McpTaskRecord>
{
	if (task.toolInvocationRowId === null || _Terminal(task) !== null)
		return task;
	const outcome = await context.checkpoint({ stepName: "admit-mcp-runtime" }, async function _Admit(): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		return _Retryable(async function _AdmitRuntime(): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
		{
			return options.runtime.admitInvocation(task.toolInvocationRowId as string);
		});
	});
	if (outcome === "admitted" || outcome === "idempotent")
		return task;
	return options.unitOfWork.execute(async function _Fail(transaction): Promise<McpTaskRecord>
	{
		const failureCode = outcome === "not_ready" ? "mcp_tool_not_ready" : "mcp_tool_not_found";
		const failed = await transaction.mcpTasks.recordFailure(input.siloId, input.mcpTaskId, input.callDigest, failureCode);
		if (failed === null)
			throw new WorkflowTaskTerminalError("MCP task terminal failure could not be saved");
		return failed;
	});
}

/** Wait durably until the companion transaction projects a terminal result. */
async function _AwaitTerminal(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult>
{
	while (true)
	{
		const task = await _Load(options, input);
		const terminal = _Terminal(task);
		if (terminal !== null)
			return terminal;
		await context.sleepUntil(new Date(Date.now() + options.statusPollMilliseconds));
	}
}

/** Derive an event name without placing product identifiers in engine diagnostics. */
function _InputEventName(input: McpTaskWorkflowInput): string
{
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.mcpTaskId, input.callDigest, McpTaskEvents.InputSubmitted])).digest("hex");
	return `workflows:mcp-task-input:${digest}`;
}

/** Run the durable public task lifecycle from saved input through OCI execution. */
async function _Run(context: IWorkflowTaskContext, options: McpTaskWorkflowOptions, input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult>
{
	let task = await _Load(options, input);
	let terminal = _Terminal(task);
	if (terminal !== null)
		return terminal;
	task = await _AwaitInput(context, options, input, task);
	terminal = _Terminal(task);
	if (terminal !== null)
		return terminal;
	task = await _AdmitToolInvocation(context, options, input);
	terminal = _Terminal(task);
	if (terminal !== null)
		return terminal;
	task = await _AdmitRuntime(context, options, input, task);
	terminal = _Terminal(task);
	if (terminal !== null)
		return terminal;
	return _AwaitTerminal(context, options, input);
}

/** Derive the stable workflow key from opaque task coordinates. */
export function __McpTaskWorkflowKey(input: McpTaskWorkflowInput): string
{
	const digest = createHash("sha256").update(JSON.stringify([input.siloId, input.mcpTaskId, input.callDigest])).digest("hex");
	return `workflows:mcp-task:${digest}`;
}

/** Register real OCI-backed MCP task execution and return its product-facing control port. */
export function __CreateMcpTaskWorkflow(options: McpTaskWorkflowOptions): McpTaskWorkflow
{
	if (!Number.isSafeInteger(options.statusPollMilliseconds) || options.statusPollMilliseconds < 100 || options.statusPollMilliseconds > 60_000)
		throw new Error("MCP task polling must be between 100 and 60000 milliseconds");
	options.execution.register({
		taskName: McpTaskTaskNames.Call,
		retryPolicy: { maximumAttempts: 5, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 1, multiplier: 2, maximumDelaySeconds: 30 } },
		async run(context: IWorkflowTaskContext, input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult>
		{
			return _Run(context, options, input);
		},
	});
	return {
		async admit(transaction: IWorkflowTransaction, input: McpTaskWorkflowInput): Promise<McpTaskAdmission>
		{
			const taskKey = __McpTaskWorkflowKey(input);
			const receipt = await options.execution.spawn(transaction, { taskName: McpTaskTaskNames.Call, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
		async deliverInput(task, input, response): Promise<void>
		{
			await options.execution.emitEvent(task, { eventName: _InputEventName(input), payload: response });
		},
		async cancel(task): Promise<void>
		{
			await options.execution.cancel(task);
		},
	};
}
