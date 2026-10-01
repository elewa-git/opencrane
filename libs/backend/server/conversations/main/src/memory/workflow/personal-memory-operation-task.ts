import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration, type IWorkflowTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import type { PersonalMemoryOperationTaskInput } from "./personal-memory-operation-task.types";
import { _PersonalMemoryOperationTaskInputSchema } from "./personal-memory-operation-task.validator";

/**
 * Shares the task name and retry policy between memory command admission and its server worker.
 *
 * A retry reloads the same saved operation. The operation's durable receipts decide whether the
 * worker may send a request or must reconcile an uncertain effect; another attempt grants no new
 * authority and does not itself permit another provider call.
 */
export const PERSONAL_MEMORY_OPERATION_TASK: IWorkflowTaskDeclaration = {
	taskName: "personal-memory-operation",
	retryPolicy: { maximumAttempts: 12, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 2, multiplier: 2, maximumDelaySeconds: 60 } },
};

/**
 * Builds identifier-only admission for the operation selected by the command transaction.
 *
 * Absurd chooses the task ID. The caller saves the returned receipt with the operation in that
 * same transaction; the operation UUID here is only the stable admission key.
 * @param input - Silo and operation identifiers selected by authenticated command admission.
 * @returns A validated task request whose retry key cannot differ from its saved operation.
 */
export function _CreatePersonalMemoryOperationTask(input: PersonalMemoryOperationTaskInput): IWorkflowTaskSpawn<PersonalMemoryOperationTaskInput>
{
	const validated = _PersonalMemoryOperationTaskInputSchema.parse(input);
	return { taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, idempotencyKey: validated.operationId, input: validated };
}
