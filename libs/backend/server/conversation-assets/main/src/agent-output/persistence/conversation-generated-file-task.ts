import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration, type IWorkflowTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import { GeneratedFileCaptureError } from "./generated-file-capture-error";
import type { ConversationGeneratedFileTaskInput } from "./generated-file-capture.types";

/** Shared declaration for the generated-file promotion worker composed by the application. */
export const CONVERSATION_GENERATED_FILE_TASK: IWorkflowTaskDeclaration = {
	taskName: "conversation-generated-file",
	retryPolicy: { maximumAttempts: 12, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 2, multiplier: 2, maximumDelaySeconds: 60 } },
};

/** Build one stable identifier-only task admission for a captured operation. */
export function _ConversationGeneratedFileTask(input: ConversationGeneratedFileTaskInput, taskKey: string): IWorkflowTaskSpawn<ConversationGeneratedFileTaskInput>
{
	if (!_Coordinate(input.siloId) || !_Coordinate(input.operationId) || !_Coordinate(taskKey))
		throw new GeneratedFileCaptureError("Generated file task coordinates are invalid");
	return { taskName: CONVERSATION_GENERATED_FILE_TASK.taskName, idempotencyKey: taskKey, input };
}

/** Reject empty or control-bearing task coordinates before workflow admission. */
function _Coordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
