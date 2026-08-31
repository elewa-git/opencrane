import type { AgentRunTaskInput } from "./agent-run-task.types";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Carries the saved task identity and run attempt for one controller request. */
export interface AgentRunWorkflowTaskRequest
{
	/** Identifies the exact AgentRun attempt the controller is acting for. */
	readonly input: AgentRunTaskInput;
	/** Identifies the durable workflow task admitted with that attempt. */
	readonly task: IWorkflowTaskReceipt;
}
