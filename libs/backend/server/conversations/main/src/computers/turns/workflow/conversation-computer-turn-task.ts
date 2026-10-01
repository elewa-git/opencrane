import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Number of workflow attempts before remote tool work must settle. */
export const CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS = 12;

/** Shares one durable task declaration between activation admission and the server worker. */
export const CONVERSATION_COMPUTER_TURN_TASK: IWorkflowTaskDeclaration = {
	taskName: "conversation-computer-turn",
	retryPolicy: {
		maximumAttempts: CONVERSATION_COMPUTER_TURN_MAXIMUM_ATTEMPTS,
		backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 2, multiplier: 2, maximumDelaySeconds: 60 },
	},
};
