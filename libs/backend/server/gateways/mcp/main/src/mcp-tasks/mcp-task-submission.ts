import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpTaskCancellationOutcomes, McpTaskInputSubmissionOutcomes, McpTaskStates } from "./mcp-task.types";
import type { McpTaskCaller, McpTaskCancellationResult, McpTaskInputResponse, McpTaskInputSubmissionResult, McpTaskRecord, McpTaskSubmissionCommand, McpTaskWorkflow, McpTaskWorkflowInput } from "./mcp-task.types";

/** Save one task and its Absurd receipt in the same database transaction. */
export async function submitMcpTask(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, command: McpTaskSubmissionCommand): Promise<McpTaskRecord | null>
{
	const requestKeyDigest = ___DigestCanonicalJson([caller.siloId, caller.principalId, command.idempotencyKey]);
	const inputRequest = command.inputRequest ?? null;
	const callDigest = ___DigestCanonicalJson([caller.siloId, caller.principalId, command.serverRevisionId, command.toolRevisionId, command.arguments, inputRequest] as JsonValue);
	return unitOfWork.execute(async function _Submit(transaction): Promise<McpTaskRecord | null>
	{
		const stored = await transaction.mcpTasks.createOrFind({ siloId: caller.siloId, principalId: caller.principalId, requestKeyDigest, callDigest, serverRevisionId: command.serverRevisionId, toolRevisionId: command.toolRevisionId, arguments: command.arguments, inputRequest });
		if (stored === null)
			return null;
		const input: McpTaskWorkflowInput = { siloId: stored.task.siloId, mcpTaskId: stored.task.id, callDigest };
		const admission = await workflow.admit(transaction.workflowTransaction, input);
		const binding = { taskId: admission.receipt.taskId, taskName: admission.receipt.taskName, taskKey: admission.taskKey };
		return transaction.mcpTasks.ensureWorkflow(caller.siloId, stored.task.id, binding);
	});
}

/** Read one caller-owned task without disclosing another Principal's task. */
export async function getMcpTask(unitOfWork: McpOperatorUnitOfWork, caller: McpTaskCaller, taskId: string): Promise<McpTaskRecord | null>
{
	return unitOfWork.execute(async function _Read(transaction): Promise<McpTaskRecord | null>
	{
		return transaction.mcpTasks.find(caller.siloId, caller.principalId, taskId);
	});
}

/** Save a matching response before waking the exact waiting workflow. */
export async function submitMcpTaskInput(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, taskId: string, response: McpTaskInputResponse): Promise<McpTaskInputSubmissionResult>
{
	const current = await getMcpTask(unitOfWork, caller, taskId);
	if (current === null || current.workflowTask === null || current.inputRequest === null)
		return { outcome: McpTaskInputSubmissionOutcomes.NotAvailable };
	if (current.inputRequest.requestId !== response.requestId)
		return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
	const input: McpTaskWorkflowInput = { siloId: current.siloId, mcpTaskId: current.id, callDigest: current.callDigest };
	if (current.inputResponse !== null)
	{
		if (___DigestCanonicalJson(current.inputResponse as unknown as JsonValue) !== ___DigestCanonicalJson(response as unknown as JsonValue))
			return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
		// Retry delivery while the saved task is still between input persistence and runtime admission.
		if (current.state === McpTaskStates.Working)
			await workflow.deliverInput(current.workflowTask, input, response);
		return { outcome: McpTaskInputSubmissionOutcomes.Accepted, task: current };
	}
	const saved = await unitOfWork.execute(async function _Save(transaction): Promise<McpTaskRecord | null>
	{
		return transaction.mcpTasks.recordInput(caller.siloId, caller.principalId, taskId, response);
	});
	if (saved === null || saved.workflowTask === null)
		return { outcome: McpTaskInputSubmissionOutcomes.Conflict };
	await workflow.deliverInput(saved.workflowTask, { siloId: saved.siloId, mcpTaskId: saved.id, callDigest: saved.callDigest }, response);
	return { outcome: McpTaskInputSubmissionOutcomes.Accepted, task: saved };
}

/** Cancel a task only when its provider-effect claim has not started. */
export async function cancelMcpTask(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, caller: McpTaskCaller, taskId: string): Promise<McpTaskCancellationResult>
{
	const current = await getMcpTask(unitOfWork, caller, taskId);
	if (current === null || current.workflowTask === null)
		return { outcome: McpTaskCancellationOutcomes.NotAvailable };
	const outcome = await unitOfWork.execute(async function _Cancel(transaction)
	{
		return transaction.mcpTasks.cancel(caller.siloId, caller.principalId, taskId);
	});
	if (outcome === "not_available")
		return { outcome: McpTaskCancellationOutcomes.NotAvailable };
	if (outcome === "too_late")
		return { outcome: McpTaskCancellationOutcomes.TooLate };
	await workflow.cancel(current.workflowTask);
	const task = await getMcpTask(unitOfWork, caller, taskId);
	return task === null ? { outcome: McpTaskCancellationOutcomes.NotAvailable } : { outcome: McpTaskCancellationOutcomes.Cancelled, task };
}
