import { createHash } from "node:crypto";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpTaskInputSubmissionOutcomes } from "./mcp-task.types";
import type { McpTaskCaller, McpTaskInputResponse, McpTaskInputSubmissionResult, McpTaskRecord, McpTaskSubmissionCommand, McpTaskWorkflow, McpTaskWorkflowInput } from "./mcp-task.types";

/** Return a SHA-256 digest without retaining a client key or tool argument value. */
function _Digest(value: unknown): string
{
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Reject a task command before it reaches product storage or workflow admission. */
function _AssertSubmission(command: McpTaskSubmissionCommand): void
{
	if (command.idempotencyKey.trim().length === 0 || command.toolName.trim().length === 0 || command.inputRequest.requestId.trim().length === 0 || command.inputRequest.message.trim().length === 0)
		throw new Error("MCP task submission fields are invalid.");
}

/** Save one task and its workflow admission through the same database transaction. */
export async function submitMcpTask(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, command: McpTaskSubmissionCommand): Promise<McpTaskRecord | null>
{
	_AssertSubmission(command);
	const requestKeyDigest = _Digest([caller.siloId, caller.principalId, command.idempotencyKey]);
	const callDigest = _Digest([caller.siloId, caller.principalId, command.toolName, command.arguments, command.inputRequest]);
	return await unitOfWork.execute(async function _Submit(transaction): Promise<McpTaskRecord | null>
	{
		const stored = await transaction.mcpTasks.createOrFind({ siloId: caller.siloId, principalId: caller.principalId, requestKeyDigest, callDigest, toolName: command.toolName, inputRequest: command.inputRequest });
		if (stored === null)
			return null;
		const taskInput: McpTaskWorkflowInput = { siloId: stored.task.siloId, mcpTaskId: stored.task.id, callDigest };
		const admission = await workflow.admit(transaction.workflowTransaction, taskInput);
		const bound = await transaction.mcpTasks.ensureWorkflow(caller.siloId, stored.task.id, { taskId: admission.receipt.taskId, taskName: admission.receipt.taskName, taskKey: admission.taskKey });
		if (bound === null)
			throw new Error("MCP task workflow admission conflicts with the saved task.");
		return bound;
	});
}

/** Read one saved MCP task only for its authenticated caller. */
export async function getMcpTask(unitOfWork: McpOperatorUnitOfWork, caller: McpTaskCaller, taskId: string): Promise<McpTaskRecord | null>
{
	return await unitOfWork.execute(async function _Get(transaction): Promise<McpTaskRecord | null>
	{
		return await transaction.mcpTasks.find(caller.siloId, caller.principalId, taskId);
	});
}

/** Save a matching input response before delivering it to the waiting workflow. */
export async function submitMcpTaskInput(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, taskId: string, response: McpTaskInputResponse): Promise<McpTaskInputSubmissionResult>
{
	if (response.requestId.trim().length === 0 || response.value.trim().length === 0)
		throw new Error("MCP task input fields are invalid.");
	const current = await getMcpTask(unitOfWork, caller, taskId);
	if (current === null || current.workflowTask === null)
		return { outcome: McpTaskInputSubmissionOutcomes.NotAvailable };
	if (current.inputRequest === null || current.inputRequest.requestId !== response.requestId)
		return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
	if (current.inputResponse !== null && current.inputResponse.value !== response.value)
		return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
	const task = await unitOfWork.execute(async function _StoreInput(transaction): Promise<McpTaskRecord | null>
	{
		return await transaction.mcpTasks.recordInput(caller.siloId, caller.principalId, taskId, response);
	});
	if (task === null || task.workflowTask === null)
		return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
	const input: McpTaskWorkflowInput = { siloId: task.siloId, mcpTaskId: task.id, callDigest: task.callDigest };
	await workflow.deliverInput(task.workflowTask, input, response);
	return { outcome: McpTaskInputSubmissionOutcomes.Accepted, task };
}
