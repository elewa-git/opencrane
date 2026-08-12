import type { ToolInvocationRecoveryEvent } from "@opencrane/backend/server/iam/authorization";

/** Repository that appends the recovery event inside the caller's transaction. */
export interface ToolRecoveryEventAppendRepository
{
	/** Appends only while the run is still on this attempt and still in RecoveryRequired. */
	append(event: ToolInvocationRecoveryEvent): Promise<boolean>;
}

/** Builds the recovery-event repository on the caller's transaction. */
export interface ToolRecoveryEventAppendUnitOfWork
{
	/** Appends the event through that transaction's repository. */
	append(event: ToolInvocationRecoveryEvent): Promise<boolean>;
}
