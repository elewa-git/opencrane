import { describe, expect, it } from "vitest";

import { RoutineFiringReasons, RoutineProposalStates } from "@opencrane/contracts";

import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus } from "../routine-gateway.types";
import { ___RoutineCreationOptionsSchema, ___RoutineDefinitionResponseSchema, ___RoutineDetailsResponseSchema, ___RoutineFiringPageSchema, ___RoutineFiringResponseSchema, ___RoutineListPageSchema, ___RoutineProposalReadResponseSchema, ___RoutineSchedulePreviewSchema } from "../routine-response.validator";

const _INSTANT = "2026-09-27T09:00:00.000Z";
const _SCHEDULE = { expression: "0 9 * * *", timezone: "UTC" };

function _Definition()
{
	return { routineId: "routine-1", currentRevision: 2, status: RoutineStatus.Active, lifecycleRevision: 3, nextAutomaticOccurrence: _INSTANT };
}

function _ListItem()
{
	return { ..._Definition(), ownership: "owner" as const, destinationConversationId: "conversation-1", selectedManagedService: { managedServiceId: "service-1", displayName: "Research assistant" }, schedule: _SCHEDULE, lastAutomaticOccurrence: null, lastFiring: null, capabilities: { revise: true, pause: true, resume: false, retire: true, runNow: true } };
}

function _HistoryItem()
{
	return { firingId: "firing-1", routineRevision: 2, trigger: RoutineFiringTrigger.Automatic, disposition: RoutineFiringDisposition.Completed, scheduledSlot: _INSTANT, createdAt: _INSTANT, finishedAt: _INSTANT, reason: null, runTerminalReason: AgentRunTerminalReasons.Success, resultConversationId: "conversation-result", actualCost: { amount: "0.00", currency: "EUR" } };
}

describe("routine response validators", function _suite()
{
	it("accepts valid definition, detail, list, history, options and preview responses", function _validResponses()
	{
		const definition = { routine: _Definition() };
		const detail = { routine: { ..._ListItem(), audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], instruction: "Summarize the reviewed conversation." } };
		expect(___RoutineDefinitionResponseSchema.safeParse(definition).success).toBe(true);
		expect(___RoutineDetailsResponseSchema.safeParse(detail).success).toBe(true);
		expect(___RoutineListPageSchema.safeParse({ items: [_ListItem()], limit: 20, nextCursor: "opaqueCursor_1" }).success).toBe(true);
		expect(___RoutineFiringPageSchema.safeParse({ items: [_HistoryItem()], limit: 20 }).success).toBe(true);
		expect(___RoutineFiringResponseSchema.safeParse({ firing: { firingId: "firing-2", routineId: "routine-1", routineRevision: 2, trigger: RoutineFiringTrigger.Manual, disposition: RoutineFiringDisposition.Preparing, scheduledSlot: null, reason: null } }).success).toBe(true);
		expect(___RoutineCreationOptionsSchema.safeParse({ destinationConversationId: "conversation-1", audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], managedServiceChoices: [{ managedServiceId: "service-1", displayName: "Research assistant" }] }).success).toBe(true);
		expect(___RoutineSchedulePreviewSchema.safeParse({ schedule: _SCHEDULE, calculatedAt: _INSTANT, nextOccurrences: [_INSTANT, _INSTANT, _INSTANT, _INSTANT, _INSTANT] }).success).toBe(true);
	});

	it("validates proposal lifecycle fields without accepting protected extras", function _proposalResponses()
	{
		const pending = { proposalRef: "proposal-1", sourceConversationId: "conversation-1", suggestion: { instruction: "Review the conversation.", schedule: _SCHEDULE }, expiresAt: _INSTANT, state: RoutineProposalStates.Pending };
		expect(___RoutineProposalReadResponseSchema.safeParse(pending).success).toBe(true);
		expect(___RoutineProposalReadResponseSchema.safeParse({ ...pending, state: RoutineProposalStates.Accepted, acceptedRoutineId: "routine-1" }).success).toBe(true);
		expect(___RoutineProposalReadResponseSchema.safeParse({ ...pending, state: RoutineProposalStates.Accepted }).success).toBe(false);
		expect(___RoutineProposalReadResponseSchema.safeParse({ ...pending, suggestion: { ...pending.suggestion, secret: "hidden" } }).success).toBe(false);
	});

	it("accepts sparse empty pages and opaque continuation tokens", function _sparsePage()
	{
		expect(___RoutineListPageSchema.safeParse({ items: [], limit: 25, nextCursor: "A".repeat(2_048) }).success).toBe(true);
		expect(___RoutineFiringPageSchema.safeParse({ items: [], limit: 1, nextCursor: "next_page-2" }).success).toBe(true);
	});

	it.each(["", "opaque token", "token/with/slash", "token+with+plus", "A".repeat(2_049)])("rejects a malformed cursor: %s", function _cursor(cursor)
	{
		expect(___RoutineListPageSchema.safeParse({ items: [], limit: 20, nextCursor: cursor }).success).toBe(false);
	});

	it("rejects unknown fields and the superseded audience principal field", function _strictBodies()
	{
		const detail = { routine: { ..._ListItem(), audienceParticipantRefs: ["participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], instruction: "Read this", audiencePrincipalIds: ["old-id"] } };
		const duplicateAudience = { routine: { ..._ListItem(), audienceParticipantRefs: ["participant-1", "participant-1"], audienceChoices: [{ participantRef: "participant-1", displayName: "You", isSelf: true }], instruction: "Read this" } };
		const preview = { schedule: _SCHEDULE, calculatedAt: _INSTANT, nextOccurrences: [_INSTANT, _INSTANT, _INSTANT, _INSTANT, _INSTANT], secret: "not-public" };
		expect(___RoutineDetailsResponseSchema.safeParse(detail).success).toBe(false);
		expect(___RoutineDetailsResponseSchema.safeParse(duplicateAudience).success).toBe(false);
		expect(___RoutineSchedulePreviewSchema.safeParse(preview).success).toBe(false);
		expect(___RoutineDefinitionResponseSchema.safeParse({ routine: { ..._Definition(), currentRevision: 0 } }).success).toBe(false);
	});

	it("accepts all closed firing reasons, zero cost and nullable result fields", function _closedValues()
	{
		for (const reason of Object.values(RoutineFiringReasons))
		{
			const item = { ..._HistoryItem(), reason, runTerminalReason: null, resultConversationId: null, actualCost: null };
			expect(___RoutineFiringPageSchema.safeParse({ items: [item], limit: 20 }).success).toBe(true);
		}
	});

	it("does not reject server-valid display names or the maximum instruction length", function _validBounds()
	{
		const detail = { routine: { ..._ListItem(), selectedManagedService: { managedServiceId: "s", displayName: "S".repeat(200) }, audienceParticipantRefs: ["p"], audienceChoices: [{ participantRef: "p", displayName: "P".repeat(200), isSelf: true }], instruction: "i".repeat(20_000) } };
		expect(___RoutineDetailsResponseSchema.safeParse(detail).success).toBe(true);
	});
});
