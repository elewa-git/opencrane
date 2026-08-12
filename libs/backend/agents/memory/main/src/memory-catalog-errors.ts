/**
 * Thrown when PostgreSQL rejected a correction because the fact it replaces is no longer active.
 *
 * Raised only after the whole transaction has already rolled back, so a catcher knows nothing
 * was written and must not retry the same correction: the predecessor will not become active
 * again. {@link __RecordMemoryFact} catches this and returns `CorrectionConflict`.
 *
 * Thrown by: {@link PrismaMemoryCatalogUnitOfWork.run}.
 */
export class __MemoryCatalogCorrectionConflictError extends Error
{
	/** Keeps the database error as `cause` for debugging, and out of the message callers see. */
	constructor(cause: unknown)
	{
		super("memory fact correction conflicts with current catalog state", { cause });
		this.name = "MemoryCatalogCorrectionConflictError";
	}
}
