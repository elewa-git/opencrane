/** Reports a caller command that cannot satisfy the routine contract. */
export class RoutineCommandValidationError extends Error
{
	/** Retains a specific internal reason without making it part of the HTTP response. */
	public constructor(message: string)
	{
		super(message);
	}
}

/** Conceals a missing routine or a current authorization refusal behind the same outcome. */
export class RoutineCommandUnavailableError extends Error
{
	/** Retains a specific internal reason without disclosing which protected fact was missing. */
	public constructor(message: string)
	{
		super(message);
	}
}

/** Requires the caller to read current state or choose another idempotency key. */
export class RoutineCommandConflictError extends Error
{
	/** Retains the conflicting invariant for focused tests and internal callers. */
	public constructor(message: string)
	{
		super(message);
	}
}
