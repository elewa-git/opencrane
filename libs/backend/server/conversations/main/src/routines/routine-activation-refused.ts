/** Signals a committed pre-admission refusal; throwing it never rolls back that refusal. */
export class RoutineActivationRefusedError extends Error
{
	/** Keeps confirmed refusal separate from unavailable storage or inconsistent history. */
	public constructor() { super("Routine activation was durably refused"); }
}
