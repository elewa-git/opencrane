import { describe, expect, it } from "vitest";

import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringReasons, RoutineFiringTrigger, RoutineStatus, type RoutineDetails, type RoutineFiringPage, type RoutineListPage } from "@opencrane/state/routines";

import { _RoutineCapabilities, _RoutineCreationChoices, _RoutineDetailsView, _RoutineHistoryRows, _RoutineListRows } from "../routine-presentation.mapper";

const _INSTANT = "2026-09-27T09:00:00.000Z";
const _DETAIL: RoutineDetails = { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, ownership: "owner", destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research" }, schedule: { expression: "0 9 * * *", timezone: "UTC" }, lastAutomaticOccurrence: null, nextAutomaticOccurrence: _INSTANT, lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true }, audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], instruction: "Review the conversation." };

describe("routine presentation mappers", function _suite()
{
	it("maps lifecycle, ownership, service and schedule labels", function _listAndDetail()
	{
		const page: RoutineListPage = { items: [{ routineId: _DETAIL.routineId, currentRevision: _DETAIL.currentRevision, status: _DETAIL.status, lifecycleRevision: _DETAIL.lifecycleRevision, ownership: _DETAIL.ownership, destinationConversationId: _DETAIL.destinationConversationId, selectedManagedService: _DETAIL.selectedManagedService, schedule: _DETAIL.schedule, lastAutomaticOccurrence: _DETAIL.lastAutomaticOccurrence, nextAutomaticOccurrence: _DETAIL.nextAutomaticOccurrence, lastFiring: _DETAIL.lastFiring, capabilities: _DETAIL.capabilities }], limit: 20 };
		const rows = _RoutineListRows(page);
		const detail = _RoutineDetailsView(_DETAIL);
		expect(rows[0]?.status.label).toBe("Active");
		expect(rows[0]?.ownershipLabel).toBe("Created by you");
		expect(rows[0]?.serviceLabel).toBe("Research");
		expect(detail.audienceLabels).toEqual(["You · You"]);
		expect(detail.instruction).toBe("Review the conversation.");
	});

	it("copies server capability hints without changing authority", function _capabilities()
	{
		expect(_RoutineCapabilities(_DETAIL)).toEqual(_DETAIL.capabilities);
	});

	it("maps safe creation choices and known firing labels", function _choicesAndHistory()
	{
		const choices = _RoutineCreationChoices({ destinationConversationId: "conversation-1", audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], managedServiceChoices: [{ managedServiceId: "service-1", displayName: "Research" }] });
		const page: RoutineFiringPage = { items: [{ firingId: "firing-1", routineRevision: 2, trigger: RoutineFiringTrigger.Automatic, disposition: RoutineFiringDisposition.Completed, scheduledSlot: _INSTANT, createdAt: _INSTANT, finishedAt: _INSTANT, reason: RoutineFiringReasons.UnfinishedFiring, runTerminalReason: null, resultConversationId: null, actualCost: null }, { firingId: "firing-2", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Completed, scheduledSlot: null, createdAt: _INSTANT, finishedAt: _INSTANT, reason: null, runTerminalReason: AgentRunTerminalReasons.Success, resultConversationId: "conversation-result", actualCost: { amount: "0.00", currency: "EUR" } }], limit: 20 };
		const rows = _RoutineHistoryRows(page, "UTC");
		expect(choices.audience[0]?.label).toBe("You");
		expect(choices.services[0]?.label).toBe("Research");
		expect(rows[0]?.reasonLabel).toBe("Another firing was still unfinished.");
		expect(rows[0]?.costLabel).toBe("Not recorded");
		expect(rows[1]?.costLabel).toBe("0.00 EUR");
		expect(rows[1]?.resultConversationId).toBe("conversation-result");
	});
});
