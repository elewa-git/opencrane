/** Domain signal raised only after a correction-conflict transaction has rolled back. */
export class __MemoryCatalogCorrectionConflictError extends Error
{
	/** Preserves the database rejection as diagnostic cause without exposing it as a product result. */
	constructor(cause: unknown)
	{
		super("memory fact correction conflicts with current catalog state", { cause });
		this.name = "MemoryCatalogCorrectionConflictError";
	}
}
