/** One bounded page of active routine schedule heads to repair. */
export interface RoutineScheduleRepairPage
{
	/** Silo whose routines may be repaired. */
	readonly siloId: string;
	/** Maximum number of routine heads to inspect. */
	readonly limit: number;
	/** Exclusive stable routine-id cursor from the previous page. */
	readonly afterRoutineId: string | null;
}

/** Result of one transaction-owned schedule repair page. */
export interface RoutineScheduleRepairPageResult
{
	/** Number of complete active schedule heads inspected. */
	readonly checked: number;
	/** Last routine id when another page may exist, otherwise null. */
	readonly nextCursor: string | null;
}
