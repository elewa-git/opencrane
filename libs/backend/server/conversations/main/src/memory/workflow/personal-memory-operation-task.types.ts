/** Identifies saved work without placing memory content or authority in the workflow queue. */
export interface PersonalMemoryOperationTaskInput
{
	/** Silo whose saved operation the worker must load and authorize again. */
	readonly siloId: string;
	/** Immutable operation UUID used for both task admission and restart recovery. */
	readonly operationId: string;
}

/** In-process task-result discriminator returned by the worker and not persisted separately. */
export enum PersonalMemoryOperationTaskOutcomes
{
	/** The saved operation already reached every required provider and catalog outcome. */
	Completed = "completed",
}

/** Closed result returned only after the saved operation reaches its terminal phase. */
export interface PersonalMemoryOperationTaskResult
{
	/** Confirms that every provider and catalog phase reached durable completion. */
	readonly outcome: PersonalMemoryOperationTaskOutcomes.Completed;
	/** Exact operation UUID loaded from the identifier-only task input. */
	readonly operationId: string;
}
