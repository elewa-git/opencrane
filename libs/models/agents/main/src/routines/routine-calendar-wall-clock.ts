import { DateTime } from "luxon";

/**
 * Represents an instant's displayed local fields as a UTC timestamp for cron arithmetic.
 *
 * @param epochMs - UTC instant to display in the timezone.
 * @param timezone - IANA timezone used for the display.
 * @returns The nominal local fields encoded as a UTC timestamp.
 * @throws {Error} When the timezone library cannot resolve the instant.
 */
export function _RoutineWallClockCursor(epochMs: number, timezone: string): number
{
	const local = DateTime.fromMillis(epochMs, { zone: timezone });
	if (!local.isValid)
		throw new Error("Routine calendar cannot resolve the supplied instant");
	return epochMs + local.offset * 60_000;
}

/**
 * Includes the first copy when an instant lies in a repeated local period.
 *
 * A reverse search from the second displayed clock would otherwise miss later minutes from the
 * first copy of the repeated period.
 *
 * @param epochMs - UTC instant from which reverse calendar search begins.
 * @param timezone - IANA timezone used for the search.
 * @returns The latest nominal local cursor that can contain the instant.
 * @throws {Error} When the timezone library cannot resolve the instant.
 */
export function _RoutineLatestWallClockCursor(epochMs: number, timezone: string): number
{
	const local = DateTime.fromMillis(epochMs, { zone: timezone });
	if (!local.isValid)
		throw new Error("Routine calendar cannot resolve the supplied instant");
	const offsets = local.getPossibleOffsets().map(possible => possible.offset);
	return epochMs + Math.max(...offsets) * 60_000;
}

/**
 * Resolves local calendar fields to their earliest UTC instant.
 *
 * A local time that a timezone transition skipped returns null. Starting from an explicit timestamp
 * avoids the ambient clock read in Luxon's object constructor.
 *
 * @param nominalEpochMs - Local fields encoded as a UTC timestamp.
 * @param timezone - IANA timezone in which the fields should exist.
 * @returns The earliest matching UTC instant, or null when the local time did not happen.
 * @throws {Error} When the candidate falls outside the supported date system.
 */
export function _RoutineWallClockInstant(nominalEpochMs: number, timezone: string): number | null
{
	const nominal = DateTime.fromMillis(nominalEpochMs, { zone: "UTC" });
	const local = nominal.setZone(timezone, { keepLocalTime: true });
	if (!nominal.isValid || !local.isValid)
		throw new Error("Routine calendar candidate is outside the supported date system");
	if (local.setZone("UTC", { keepLocalTime: true }).toMillis() !== nominalEpochMs)
		return null;
	const candidates = local.getPossibleOffsets().filter(possible => possible.isValid && possible.setZone("UTC", { keepLocalTime: true }).toMillis() === nominalEpochMs);
	if (candidates.length === 0)
		throw new Error("Routine calendar cannot resolve a matching local instant");
	return Math.min(...candidates.map(possible => possible.toMillis()));
}
