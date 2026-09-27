import type { RoutineDetails, RoutineSchedule } from "@opencrane/state/routines";

import { RoutineScheduleModes, type RoutineDefinitionDraft, type RoutinePreviewView } from "./routine-presentation.types";

/** Local time grammar used by the daily and weekly form modes. */
const _LOCAL_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u;

/** Builds the server schedule represented by the current controlled draft. */
export function _RoutineScheduleFromDraft(draft: RoutineDefinitionDraft): RoutineSchedule | null
{
	if (draft.timezone.trim().length === 0)
		return null;
	if (draft.scheduleMode === RoutineScheduleModes.Advanced)
	{
		const expression = draft.expression.trim();
		return expression.length === 0 ? null : { expression, timezone: draft.timezone.trim() };
	}
	if (!_LOCAL_TIME.test(draft.localTime))
		return null;
	const [hour, minute] = draft.localTime.split(":");
	if (hour === undefined || minute === undefined)
		return null;
	const expression = draft.scheduleMode === RoutineScheduleModes.Daily ? `${Number(minute)} ${Number(hour)} * * *` : `${Number(minute)} ${Number(hour)} * * ${draft.weekday}`;
	return { expression, timezone: draft.timezone.trim() };
}

/** Creates a blank routine draft with the browser's named timezone and requester-only audience. */
export function _NewRoutineDraft(selfReference: string | null): RoutineDefinitionDraft
{
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	return { scheduleMode: RoutineScheduleModes.Daily, localTime: "09:00", weekday: 1, expression: "0 9 * * *", timezone, instruction: "", selectedManagedServiceId: null, audienceParticipantRefs: selfReference === null ? [] : [selfReference] };
}

/** Creates a revision draft while preserving an arbitrary saved cron expression. */
export function _RoutineRevisionDraft(detail: RoutineDetails): RoutineDefinitionDraft
{
	const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/u.exec(detail.schedule.expression);
	if (daily !== null)
		return { scheduleMode: RoutineScheduleModes.Daily, localTime: _Time(daily[2], daily[1]), weekday: 1, expression: detail.schedule.expression, timezone: detail.schedule.timezone, instruction: detail.instruction, selectedManagedServiceId: detail.selectedManagedService.managedServiceId, audienceParticipantRefs: detail.audienceParticipantRefs };
	const weekly = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/u.exec(detail.schedule.expression);
	if (weekly !== null)
		return { scheduleMode: RoutineScheduleModes.Weekly, localTime: _Time(weekly[2], weekly[1]), weekday: Number(weekly[3]), expression: detail.schedule.expression, timezone: detail.schedule.timezone, instruction: detail.instruction, selectedManagedServiceId: detail.selectedManagedService.managedServiceId, audienceParticipantRefs: detail.audienceParticipantRefs };
	return { scheduleMode: RoutineScheduleModes.Advanced, localTime: "09:00", weekday: 1, expression: detail.schedule.expression, timezone: detail.schedule.timezone, instruction: detail.instruction, selectedManagedServiceId: detail.selectedManagedService.managedServiceId, audienceParticipantRefs: detail.audienceParticipantRefs };
}

/** Lists named browser timezones for the searchable PrimeNG selector. */
export function _RoutineTimezones(): readonly string[]
{
	const current = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const supported = Intl.supportedValuesOf("timeZone");
	return supported.includes(current) ? supported : [current, ...supported];
}

/** Maps the server preview into timezone-aware display strings. */
export function _RoutinePreviewView(preview: { readonly schedule: RoutineSchedule; readonly calculatedAt: string; readonly nextOccurrences: readonly string[] }): RoutinePreviewView
{
	return { calculatedAtLabel: _RoutineInstant(preview.calculatedAt, preview.schedule.timezone), scheduleLabel: `${preview.schedule.expression} · ${preview.schedule.timezone}`, occurrences: preview.nextOccurrences.map(value => _RoutineInstant(value, preview.schedule.timezone)) };
}

/** Formats one server instant in the routine's named timezone. */
export function _RoutineInstant(value: string | null, timezone: string, fallback = "Not yet"): string
{
	if (value === null)
		return fallback;
	return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone, timeZoneName: "short" }).format(new Date(value));
}

/** Formats a captured numeric time with leading zeroes. */
function _Time(hour: string | undefined, minute: string | undefined): string
{
	return `${Number(hour).toString().padStart(2, "0")}:${Number(minute).toString().padStart(2, "0")}`;
}
