/** Identifies saved work without placing memory content or authority in the workflow queue. */
export interface PersonalMemoryOperationTaskInput
{
	/** Silo whose saved operation the worker must load and authorize again. */
	readonly siloId: string;
	/** Immutable operation UUID used for both task admission and restart recovery. */
	readonly operationId: string;
}
