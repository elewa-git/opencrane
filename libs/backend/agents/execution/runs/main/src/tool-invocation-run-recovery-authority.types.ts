import type { ToolInvocationRunRecoveryCommand, ToolInvocationRunRecoveryEnterResult } from "@opencrane/backend/server/iam/authorization";

/** Transaction-bound repository for the run lifecycle state owned by tool recovery. */
export interface ToolInvocationRunRecoveryRepository
{
	/** Enter RecoveryRequired from Running, accepting an already-entered exact attempt. */
	enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/** Resume Running from RecoveryRequired, accepting an already-resumed exact attempt. */
	resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>;
}

/** Transaction unit that constructs the run recovery repository over an exact caller transaction. */
export interface ToolInvocationRunRecoveryUnitOfWork extends ToolInvocationRunRecoveryRepository {}
