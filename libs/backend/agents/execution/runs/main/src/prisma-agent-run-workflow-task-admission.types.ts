import type { AgentRunWorkflowAdmission, AgentRunWorkflowAdmissionCommand } from "@opencrane/backend/agents/execution/runs/workflows";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

/** Admits one AgentRun task through the database transaction that owns the attempt. */
export interface AgentRunWorkflowTaskAdmissionUnitOfWork
{
	/** Saves and receipt-binds the controller task before its owning transaction may commit. */
	admit(workflow: Pick<IWorkflowEngine, "spawn">, command: AgentRunWorkflowAdmissionCommand): Promise<AgentRunWorkflowAdmission>;
}
