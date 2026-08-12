import type { ToolInvocationRunRecoveryCommand, ToolInvocationRunRecoveryEnterResult } from "@opencrane/backend/server/iam/authorization";

/** Repository that changes the run state for tool recovery, inside the caller's transaction. */
export interface ToolInvocationRunRecoveryRepository
{
	/** Moves the run from Running to RecoveryRequired, or reports that this attempt is already there. */
	enterRecoveryRequired(command: ToolInvocationRunRecoveryCommand): Promise<ToolInvocationRunRecoveryEnterResult>;
	/** Moves the run from RecoveryRequired back to Running, or reports that this attempt is already Running. */
	resumeRunning(command: ToolInvocationRunRecoveryCommand): Promise<boolean>;
}

/** Builds the run-recovery repository on the transaction the caller supplies. */
export interface ToolInvocationRunRecoveryUnitOfWork extends ToolInvocationRunRecoveryRepository {}
