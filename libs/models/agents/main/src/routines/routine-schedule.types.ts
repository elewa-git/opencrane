/**
 * Selects local calendar times without granting permission to start a routine.
 *
 * The five numeric cron fields represent minute, hour, day, month and weekday. The timezone is an
 * Internet Assigned Numbers Authority (IANA) name. Missing local times are skipped, while a local
 * time that happens twice selects its earliest UTC instant.
 */
export interface RoutineSchedule
{
	/** Contains the five numeric cron fields with one space between fields. */
	readonly expression: string;
	/** Names the IANA timezone in which the cron fields are read. */
	readonly timezone: string;
}
