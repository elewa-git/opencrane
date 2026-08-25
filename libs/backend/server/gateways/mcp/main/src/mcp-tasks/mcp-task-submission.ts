import { ___DigestCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpTaskInputSubmissionOutcomes } from "./mcp-task.types";
import type { McpTaskCaller, McpTaskInputResponse, McpTaskInputSubmissionResult, McpTaskRecord, McpTaskSubmissionCommand, McpTaskWorkflow, McpTaskWorkflowInput } from "./mcp-task.types";

/** Return a SHA-256 digest without retaining a client key or tool argument value. */
function _Digest(value: unknown): string
{
	return ___DigestCanonicalJson(value as JsonValue);
}

/** Reject a task command before it reaches product storage or workflow admission. */
function _AssertSubmission(command: McpTaskSubmissionCommand): void
{
	if (command.idempotencyKey.trim().length === 0 || command.toolName.trim().length === 0 || command.inputRequest.requestId.trim().length === 0 || command.inputRequest.message.trim().length === 0)
		throw new Error("MCP task submission fields are invalid.");
}

/**
 * Saves an asynchronous tool call and binds its workflow in the same database transaction.
 *
 * A repeated idempotency key returns the existing task only when the caller and immutable call
 * digest match; otherwise `null` prevents the retry from changing another call. The focused
 * lifecycle test proves that the task write, engine admission, and receipt binding share the
 * product transaction.
 *
 * @returns The saved task, or `null` when a reused key conflicts with saved facts.
 * @throws Error when a required submission field is blank or workflow binding conflicts.
 */
export async function submitMcpTask(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, command: McpTaskSubmissionCommand): Promise<McpTaskRecord | null>
{
	_AssertSubmission(command);
	const requestKeyDigest = _Digest([caller.siloId, caller.principalId, command.idempotencyKey]);
	const callDigest = _Digest([caller.siloId, caller.principalId, command.toolName, command.arguments, { requestId: command.inputRequest.requestId, message: command.inputRequest.message }]);
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

/**
 * Reads a saved task for the authenticated caller.
 *
 * The repository uses both silo and principal, so `null` covers a missing task and a task owned by
 * someone else rather than disclosing which case occurred.
 *
 * @returns The caller's task, or `null` when it is unavailable to that caller.
 */
export async function getMcpTask(unitOfWork: McpOperatorUnitOfWork, caller: McpTaskCaller, taskId: string): Promise<McpTaskRecord | null>
{
	return await unitOfWork.execute(async function _Get(transaction): Promise<McpTaskRecord | null>
	{
		return await transaction.mcpTasks.find(caller.siloId, caller.principalId, taskId);
	});
}

/**
 * Saves a matching client response before emitting its workflow event.
 *
 * The saved response lets a workflow replay complete without waiting for a second event. `Accepted`
 * means the event was delivered; `NotAvailable` does not disclose task ownership; and `Conflict`
 * means the request or response differs from saved input.
 *
 * @returns The outcome the client must use to decide whether its input was accepted.
 * @throws Error when the request identifier or response text is blank.
 */
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
