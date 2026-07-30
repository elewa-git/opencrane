import type { ScheduleTickResult } from "./schedule-tick.types.js";

/**
 * One managed-agent schedule ticker over the shared run-admission authority.
 *
 * `runOnce` evaluates every enabled schedule at the given instant and admits due slots through the
 * same managed run-admission port as run-now. Each cursor advances only through admitted slots, so
 * a transient admission failure remains eligible for a later pass.
 */
export interface ScheduleTicker
{
	/** Evaluates every enabled schedule once and returns each schedule's tick result. */
	runOnce(now: Date): Promise<readonly { readonly scheduleId: string; readonly result: ScheduleTickResult }[]>;
}
