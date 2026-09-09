import { WorkflowTaskRetryBackoffKinds, type IWorkflowTaskDeclaration } from "@opencrane/backend/server/infra/workflows/contract";

/** Shares one durable declaration between the admitting server and its registered recovery worker. */
export const GROUP_CHILD_TASK: IWorkflowTaskDeclaration = { taskName: "conversation.group-child.create.v1", retryPolicy: { maximumAttempts: 12, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 2, multiplier: 2, maximumDelaySeconds: 60 } } };
