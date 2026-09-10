import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { ToolInvocationLifecycleEvent } from "@opencrane/backend/server/iam/authorization";

/** Binds one admitted run attempt to the workflow task allowed to perform its model effects. */
export interface ConversationComputerTurnWorkflowReceiptBinder
{
	/** Returns true for the first exact binding and its replays, or false when another task owns the attempt. */
	bind(runId: string, attempt: number, receipt: IWorkflowTaskReceipt): Promise<boolean>;
}

/** Wakes the saved turn workflow from the transaction that accepts terminal tool evidence. */
export interface ConversationComputerTurnWorkflowEventRepository
{
	/** Emits the matching workflow event only when the run is bound to a conversation turn task. */
	emit(event: ToolInvocationLifecycleEvent): Promise<void>;
}
