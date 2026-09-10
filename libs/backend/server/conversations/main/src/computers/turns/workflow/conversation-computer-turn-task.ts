import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Shares one durable task declaration between activation admission and the server worker. */
export const CONVERSATION_COMPUTER_TURN_TASK: IWorkflowTaskDeclaration = {
	taskName: "conversation-computer-turn",
	retryPolicy: {
		maximumAttempts: 12,
		backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 2, multiplier: 2, maximumDelaySeconds: 60 },
	},
};
