/** One parsed standard 5-field cron expression evaluated against a wall clock. */
export interface CronExpression
{
	/** Matching minute-of-hour values (0-59). */
	readonly minutes: ReadonlySet<number>;
	/** Matching hour-of-day values (0-23). */
	readonly hours: ReadonlySet<number>;
	/** Matching day-of-month values (1-31). */
	readonly daysOfMonth: ReadonlySet<number>;
	/** Matching month values (1-12). */
	readonly months: ReadonlySet<number>;
	/** Matching day-of-week values normalised to 0-6 with Sunday as 0. */
	readonly daysOfWeek: ReadonlySet<number>;
	/** Whether the day-of-month field was restricted (not `*`), for Vixie OR-of-days semantics. */
	readonly dayOfMonthRestricted: boolean;
	/** Whether the day-of-week field was restricted (not `*`), for Vixie OR-of-days semantics. */
	readonly dayOfWeekRestricted: boolean;
}

/** Wall-clock components of one instant resolved in a named IANA timezone. */
export interface WallClock
{
	/** Minute of the hour (0-59). */
	readonly minute: number;
	/** Hour of the day (0-23). */
	readonly hour: number;
	/** Day of the month (1-31). */
	readonly dayOfMonth: number;
	/** Month of the year (1-12). */
	readonly month: number;
	/** Day of the week normalised to 0-6 with Sunday as 0. */
	readonly dayOfWeek: number;
}

/** Bounds applied when enumerating the scheduled slots due within a catch-up window. */
export interface DueScheduledSlotsOptions
{
	/** Timezone the cron expression is evaluated in. */
	readonly timezone: string;
	/** Exclusive lower bound: the newest slot already admitted, or null when never scheduled. */
	readonly afterInstant: string | null;
	/** Inclusive upper bound: the current evaluation instant. */
	readonly nowInstant: string;
	/** Bounded catch-up horizon in seconds; a due slot older than `now − window` is skipped. */
	readonly catchupWindowSeconds: number;
	/** Hard ceiling on the number of slots returned by one evaluation. */
	readonly maxSlots: number;
}
