/** Delivers one task-scoped event through a caller-owned database transaction. */
export interface IWorkflowTaskEventAdmission
{
	/** Calls the fixed Absurd event procedure without opening or committing another transaction. */
	emit(transactionClient: unknown, eventName: string, payload: unknown): Promise<void>;
}
