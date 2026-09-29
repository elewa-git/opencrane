import { describe, expect, it } from "vitest";

import { RoutineScheduleModes, type RoutineDefinitionDraft } from "../routine-presentation.types";
import { _NewRoutineDraft, _RoutineInstant, _RoutinePreviewView, _RoutineRevisionDraft, _RoutineScheduleFromDraft } from "../routine-schedule";

const _BASE_DRAFT: RoutineDefinitionDraft = { scheduleMode: RoutineScheduleModes.Daily, localTime: "09:05", weekday: 1, expression: "0 9 * * *", timezone: "UTC", instruction: "Review the conversation.", selectedManagedServiceId: "service-1", audienceParticipantRefs: ["participant-1"] };
const _DETAIL = { routineId: "routine-1", currentRevision: 4, status: "active" as const, lifecycleRevision: 5, ownership: "owner" as const, destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "7 6 * * 2", timezone: "Europe/Brussels" }, lastAutomaticOccurrence: "2026-09-22T06:07:00.000Z", nextAutomaticOccurrence: "2026-09-29T06:07:00.000Z", lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], instruction: "Preserve this instruction." };

describe("routine schedule helpers", function _suite()
{
	it("builds daily and weekly numeric expressions from the draft", function _dailyWeekly()
	{
		expect(_RoutineScheduleFromDraft(_BASE_DRAFT)).toEqual({ expression: "5 9 * * *", timezone: "UTC" });
		expect(_RoutineScheduleFromDraft({ ..._BASE_DRAFT, scheduleMode: RoutineScheduleModes.Weekly, weekday: 4 })).toEqual({ expression: "5 9 * * 4", timezone: "UTC" });
	});

	it("preserves an advanced server expression while normalizing the timezone", function _advanced()
	{
		expect(_RoutineScheduleFromDraft({ ..._BASE_DRAFT, scheduleMode: RoutineScheduleModes.Advanced, expression: "  15 10 * * 1-5  ", timezone: " Europe/Brussels " })).toEqual({ expression: "15 10 * * 1-5", timezone: "Europe/Brussels" });
	});

	it("rejects incomplete drafts without inventing a browser schedule", function _invalidDrafts()
	{
		expect(_RoutineScheduleFromDraft({ ..._BASE_DRAFT, timezone: " " })).toBeNull();
		expect(_RoutineScheduleFromDraft({ ..._BASE_DRAFT, localTime: "9:05" })).toBeNull();
		expect(_RoutineScheduleFromDraft({ ..._BASE_DRAFT, scheduleMode: RoutineScheduleModes.Advanced, expression: " " })).toBeNull();
	});

	it("keeps an arbitrary saved revision in advanced mode", function _revision()
	{
		const draft = _RoutineRevisionDraft(_DETAIL);
		expect(draft.scheduleMode).toBe(RoutineScheduleModes.Weekly);
		expect(draft.expression).toBe("7 6 * * 2");
		expect(draft.audienceParticipantRefs).toEqual(["participant-1"]);
		expect(_RoutineRevisionDraft({ ..._DETAIL, schedule: { expression: "15 10 * * 1-5", timezone: "UTC" } }).scheduleMode).toBe(RoutineScheduleModes.Advanced);
	});

	it("formats named-timezone instants and uses the explicit null fallback", function _instant()
	{
		const formatted = _RoutineInstant("2026-01-15T12:00:00.000Z", "Europe/Brussels");
		expect(formatted).toContain("Jan");
		expect(formatted).toContain("13:00");
		expect(_RoutineInstant(null, "UTC", "Not scheduled")).toBe("Not scheduled");
	});

	it("maps all five server preview occurrences without a browser calendar", function _preview()
	{
		const preview = _RoutinePreviewView({ schedule: { expression: "0 9 * * *", timezone: "UTC" }, calculatedAt: "2026-09-27T09:00:00.000Z", nextOccurrences: ["2026-09-28T09:00:00.000Z", "2026-09-29T09:00:00.000Z", "2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z"] });
		expect(preview.occurrences).toHaveLength(5);
		expect(preview.scheduleLabel).toBe("0 9 * * * · UTC");
	});

	it("starts a new draft with only the supplied self reference", function _newDraft()
	{
		expect(_NewRoutineDraft("participant-1").audienceParticipantRefs).toEqual(["participant-1"]);
		expect(_NewRoutineDraft(null).audienceParticipantRefs).toEqual([]);
	});
});
