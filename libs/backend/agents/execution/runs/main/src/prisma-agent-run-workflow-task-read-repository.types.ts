import type { AgentRunTaskInput } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** Holds frozen identity evidence that chooses the task's runtime workload class. */
export interface AgentRunWorkflowSnapshotIdentity
{
	/** Identifies the person or managed service that owns this run. */
	readonly subjectId: string;
	/** Identifies the managed service, or is null for a personal run. */
	readonly managedServiceId: string | null;
	/** Limits how long the snapshot remains valid for workload assignment. */
	readonly trustedUntil: Date;
}

/** Reads the current task through the transaction owned by the warm runtime lifecycle. */
export interface AgentRunWorkflowTaskReadPersistenceRepository
{
	/** Returns the receipt-fenced task row, or null after another controller replaced it. */
	read(input: AgentRunTaskInput, receipt: IWorkflowTaskReceipt): Promise<unknown | null>;
}
