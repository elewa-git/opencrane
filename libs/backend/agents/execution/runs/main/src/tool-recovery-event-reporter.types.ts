import type { ToolInvocationRecoveryEvent } from "@opencrane/backend/server/iam/authorization";

/** Repository that appends one canonical recovery event under an existing transaction. */
export interface ToolRecoveryEventAppendRepository
{
	/** Append only when the exact run attempt is still recovery-required. */
	append(event: ToolInvocationRecoveryEvent): Promise<boolean>;
}

/** Transaction binding that owns construction of the recovery-event repository. */
export interface ToolRecoveryEventAppendUnitOfWork
{
	/** Append through the exact transaction-bound repository. */
	append(event: ToolInvocationRecoveryEvent): Promise<boolean>;
}
