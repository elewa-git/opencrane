import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it } from "vitest";

import { _ConversationComputerOutputExpectedRevision, _ConversationComputerOutputReservation, _ConversationComputerTurnStream, _ConversationComputerUnavailableDecision, _ReadConversationComputerUnavailable } from "../conversation-computer-turn-protocol";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

const _BOOTSTRAP_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _MODEL = { invocationFence: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
const _TOOL = { proposalId: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
const _CONTINUATION = { invocationFence: "61c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
const _FROZEN = {
	bootstrapId: _BOOTSTRAP_ID,
	siloId: "silo-1",
	computerId: "computer-1",
	lease: { leaseId: "lease-1", leaseGeneration: 1 },
	modelReservation: null,
	toolSelection: null,
	continuationReservation: null,
	outputReceipt: null,
	unavailable: false,
} as FrozenConversationComputerTurn;

/** Build each valid non-terminal protocol state from its durable progress fields. */
function _Turn(state: "frozen" | "model" | "tool" | "continuation"): FrozenConversationComputerTurn
{
	if (state === "continuation")
		return { ..._FROZEN, modelReservation: _MODEL, toolSelection: _TOOL, continuationReservation: _CONTINUATION } as FrozenConversationComputerTurn;
	if (state === "tool")
		return { ..._FROZEN, modelReservation: _MODEL, toolSelection: _TOOL } as FrozenConversationComputerTurn;
	if (state === "model")
		return { ..._FROZEN, modelReservation: _MODEL } as FrozenConversationComputerTurn;
	return _FROZEN;
}

describe("conversation computer private turn protocol", function _Suite()
{
	it.each([
		["frozen", 0n, _BOOTSTRAP_ID],
		["model", 1n, _MODEL.invocationFence],
		["tool", 2n, _TOOL.proposalId],
		["continuation", 3n, _CONTINUATION.invocationFence],
	] as const)("lets unavailable win the %s state's exact next position", function _UnavailableCell(state, expectedRevision, decisionFence)
	{
		const turn = _Turn(state);
		const decision = _ConversationComputerUnavailableDecision(turn);
		expect(decision.expectedRevision).toBe(expectedRevision);
		expect(decision.event.data).toEqual({ bootstrapId: _BOOTSTRAP_ID, decisionFence });
		const metadata = Object.fromEntries(Object.entries(decision.event.metadata).map(([key, value]) => [key, String(value)]));
		const recorded = { ...decision.event, streamName: _ConversationComputerTurnStream(_BOOTSTRAP_ID), revision: expectedRevision + 1n, recordedAt: new Date(), metadata } as HistoryRecordedEvent;
		expect(_ReadConversationComputerUnavailable(recorded, turn)).toBe(true);
	});

	it.each([
		["model", 1n, _MODEL.invocationFence],
		["continuation", 3n, _CONTINUATION.invocationFence],
	] as const)("maps %s output to its state-owned checked-append position", function _OutputCell(state, expectedRevision, invocationFence)
	{
		const turn = _Turn(state);
		expect(_ConversationComputerOutputExpectedRevision(turn)).toBe(expectedRevision);
		expect(_ConversationComputerOutputReservation(turn).invocationFence).toBe(invocationFence);
	});

	it.each(["frozen", "tool"] as const)("refuses output in the %s state", function _RejectsOutput(state)
	{
		expect(() => _ConversationComputerOutputExpectedRevision(_Turn(state))).toThrow("cannot complete unresolved tool work");
	});

	it("rejects an unavailable event copied into another protocol position", function _RejectsCrossStateEvent()
	{
		const frozen = _Turn("frozen");
		const decision = _ConversationComputerUnavailableDecision(frozen);
		const metadata = Object.fromEntries(Object.entries(decision.event.metadata).map(([key, value]) => [key, String(value)]));
		const recorded = { ...decision.event, streamName: _ConversationComputerTurnStream(_BOOTSTRAP_ID), revision: 1n, recordedAt: new Date(), metadata } as HistoryRecordedEvent;
		expect(() => _ReadConversationComputerUnavailable(recorded, _Turn("model"))).toThrow("invalid unavailable decision");
	});
});
