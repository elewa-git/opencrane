/** Typed refusal when the current personal-memory receipt is absent, stale, or substituted. */
export class PersonalMemoryPermissionUnavailableError extends Error
{
	/** Create a bounded denial that carries no query or personal-memory content. */
	constructor()
	{
		super("personal memory permission is unavailable");
		this.name = "PersonalMemoryPermissionUnavailableError";
	}
}

/** Typed hand-off required until the transient non-persisting memory delivery path lands. */
export class PersonalMemorySafeDeliveryRequiredError extends Error
{
	/** Create a bounded stop after exact permission verification and before any Cognee request. */
	constructor()
	{
		super("personal memory requires the safe transient delivery path");
		this.name = "PersonalMemorySafeDeliveryRequiredError";
	}
}
