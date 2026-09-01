import type { AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { ExecutionSubject } from "@opencrane/models/agents";

/** Holds frozen execution evidence that binds the task to one admitted computer lease. */
export interface AgentRunWorkflowSnapshotIdentity
{
	/** Identifies the agent identity that may exercise this workload. */
	readonly agentIdentityId: string;
	/** Identifies the principal currently realized by the agent identity. */
	readonly principalId: string;
	/** Carries the complete admitted identity, capability, run, and computer-lease evidence. */
	readonly executionSubject: ExecutionSubject;
	/** Limits how long the snapshot remains valid for workload assignment. */
	readonly trustedUntil: Date;
}

/** Reads the current task through the transaction owned by the warm runtime lifecycle. */
export interface AgentRunWorkflowTaskReadPersistenceRepository
{
	/** Returns the receipt-fenced task row, or null after another controller replaced it. */
	read(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<unknown | null>;
}
