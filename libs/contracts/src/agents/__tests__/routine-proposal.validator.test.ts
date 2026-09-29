import { describe, expect, it } from "vitest";

import { RoutineProposalStates, ___RoutineProposalReadResponseSchema, ___RoutineProposalSuggestionSchema } from "../../index";

const _SCHEDULE = { expression: "0 9 * * 1", timezone: "UTC" };
const _SUGGESTION = { instruction: "  Review the latest report.  ", schedule: _SCHEDULE };
const _BASE = { proposalRef: "proposal-1", sourceConversationId: "conversation-1", suggestion: _SUGGESTION, expiresAt: "2026-09-27T12:00:00.000Z" };

describe("routine proposal browser contracts", function _Suite()
{
	it("normalizes the requester-facing suggestion and keeps it to instruction and schedule", function _Suggestion()
	{
		expect(___RoutineProposalSuggestionSchema.parse(_SUGGESTION)).toEqual({ instruction: "Review the latest report.", schedule: _SCHEDULE });
	});

	it.each([
		{ requesterPrincipalId: "person-1" },
		{ siloId: "silo-1" },
		{ proposalId: "proposal-1" },
		{ serviceId: "service-1" },
	])("rejects authority or identity fields from the suggestion: %j", function _SuggestionFields(extra)
	{
		expect(___RoutineProposalSuggestionSchema.safeParse({ ..._SUGGESTION, ...extra }).success).toBe(false);
	});

	it.each([
		{ ..._BASE, state: RoutineProposalStates.Pending },
		{ ..._BASE, state: RoutineProposalStates.Cancelled },
		{ ..._BASE, state: RoutineProposalStates.Expired },
		{ ..._BASE, state: RoutineProposalStates.Accepted, acceptedRoutineId: "routine-1" },
	])("accepts the state-specific requester projection %#", function _Projection(value)
	{
		expect(___RoutineProposalReadResponseSchema.parse(value)).toMatchObject({ ...value, suggestion: { ...value.suggestion, instruction: value.suggestion.instruction.trim() } });
	});

	it.each([
		{ ..._BASE, state: RoutineProposalStates.Accepted },
		{ ..._BASE, state: RoutineProposalStates.Pending, acceptedRoutineId: "routine-1" },
		{ ..._BASE, state: RoutineProposalStates.Cancelled, acceptedRoutineId: "routine-1" },
		{ ..._BASE, state: RoutineProposalStates.Expired, acceptedRoutineId: "routine-1" },
		{ ..._BASE, state: RoutineProposalStates.Pending, sourceConversationId: " conversation-1" },
		{ ..._BASE, state: RoutineProposalStates.Pending, expiresAt: "tomorrow" },
		{ ..._BASE, state: RoutineProposalStates.Pending, requesterPrincipalId: "person-1" },
	])("rejects an invalid or authority-bearing requester projection %#", function _ProjectionFields(value)
	{
		expect(___RoutineProposalReadResponseSchema.safeParse(value).success).toBe(false);
	});
});
