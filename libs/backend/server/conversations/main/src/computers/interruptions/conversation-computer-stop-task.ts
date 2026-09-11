import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Declares the Absurd task that owns Stop arbitration and cleanup after SQL admission. */
export const CONVERSATION_COMPUTER_STOP_TASK: IWorkflowTaskDeclaration = {
	taskName: "conversation-computer-stop",
	retryPolicy: { maximumAttempts: 24, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 1, multiplier: 2, maximumDelaySeconds: 60 } },
};
