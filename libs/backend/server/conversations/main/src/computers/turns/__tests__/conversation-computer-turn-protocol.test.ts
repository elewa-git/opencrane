import { ConversationModelToolModes, type RunBudgetPolicy } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _ConversationComputerTurnHistoryDigest, _InitialConversationComputerTurnProtocol, _ReduceConversationComputerTurnProtocol } from "../conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolEvents, ConversationComputerTurnProtocolStates, ConversationComputerTurnUnavailableReasons } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnModelReservation, ConversationComputerTurnProtocolProjection, ConversationComputerTurnToolResult, ConversationComputerTurnToolSelection } from "../conversation-computer-turn-protocol.types";

const _DIGEST_A = `sha256:${"a".repeat(64)}`;
const _DIGEST_B = `sha256:${"b".repeat(64)}`;
const _DIGEST_C = `sha256:${"c".repeat(64)}`;
const _BUDGET: RunBudgetPolicy = { maxModelTurns: 3, maxCompletionTokens: 300, maxCostUsdMicros: null, maxToolInvocations: 2, maxLoopIterations: 2, wallClockDeadlineEpochMs: 2_000_000_000_000 };

function _Reservation(protocol: ConversationComputerTurnProtocolProjection, overrides: Partial<ConversationComputerTurnModelReservation> = {}): ConversationComputerTurnModelReservation
{
	const ordinal = protocol.steps.length + 1;
	return { ordinal, invocationFence: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`, tools: ConversationModelToolModes.Select, compiledInputDigest: _DIGEST_A, historyDigest: _ConversationComputerTurnHistoryDigest(protocol.steps), requestDigest: _DIGEST_B, maxCompletionTokens: 100, authorityExpiresAtEpochMs: 1_900_000_000_000, dispatchDeadlineEpochMs: 1_800_000_000_000, ...overrides };
}

function _Selection(ordinal = 1, overrides: Partial<ConversationComputerTurnToolSelection> = {}): ConversationComputerTurnToolSelection
{
	return { ordinal, modelInvocationFence: `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`, declaration: { payloadRef: `declaration-${ordinal}`, ciphertextDigest: _DIGEST_A }, proposalId: `proposal-${ordinal}`, toolInvocationId: `proposal-${ordinal}`, requestFingerprint: _DIGEST_B, ...overrides };
}

function _Result(ordinal = 1, overrides: Partial<ConversationComputerTurnToolResult> = {}): ConversationComputerTurnToolResult
{
	return { ordinal, proposalId: `proposal-${ordinal}`, toolInvocationId: `proposal-${ordinal}`, resultDigest: _DIGEST_C, exchange: { payloadRef: `exchange-${ordinal}`, ciphertextDigest: _DIGEST_B }, authorityExpiresAtEpochMs: 1_850_000_000_000, ...overrides };
}

function _ToolCycle(): ConversationComputerTurnProtocolProjection
{
	const open = _InitialConversationComputerTurnProtocol();
	const reserved = _ReduceConversationComputerTurnProtocol(open, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(open) }, _BUDGET);
	const selected = _ReduceConversationComputerTurnProtocol(reserved, { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection: _Selection() }, _BUDGET);
	return _ReduceConversationComputerTurnProtocol(selected, { kind: ConversationComputerTurnProtocolEvents.ToolResultRecorded, result: _Result() }, _BUDGET);
}

describe("ordered conversation turn protocol", function ()
{
	it("debits a saved tool-result cycle only when a later model step consumes it", function ()
	{
		const resultReady = _ToolCycle();
		expect(resultReady.accounting).toEqual({ reservedModelCalls: 1, reservedCompletionTokens: 100, reservedToolInvocations: 1, toolResultCyclesFed: 0 });
		const final = _ReduceConversationComputerTurnProtocol(resultReady, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(resultReady, { tools: ConversationModelToolModes.None, authorityExpiresAtEpochMs: 1_840_000_000_000 }) }, _BUDGET);
		expect(final.accounting).toEqual({ reservedModelCalls: 2, reservedCompletionTokens: 200, reservedToolInvocations: 1, toolResultCyclesFed: 1 });
		expect(final.steps.map(step => step.reservation.ordinal)).toEqual([1, 2]);
	});

	it("rejects reused step identities and wider later authority", function ()
	{
		const resultReady = _ToolCycle();
		for (const reservation of [
			_Reservation(resultReady, { invocationFence: resultReady.steps[0]!.reservation.invocationFence, tools: ConversationModelToolModes.None, authorityExpiresAtEpochMs: 1_840_000_000_000 }),
			_Reservation(resultReady, { tools: ConversationModelToolModes.None, authorityExpiresAtEpochMs: 1_860_000_000_000 }),
		])
			expect(function () { _ReduceConversationComputerTurnProtocol(resultReady, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation }, _BUDGET); }).toThrow();

		const second = _ReduceConversationComputerTurnProtocol(resultReady, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(resultReady, { authorityExpiresAtEpochMs: 1_840_000_000_000 }) }, _BUDGET);
		for (const selection of [
			_Selection(2, { proposalId: "proposal-1", toolInvocationId: "proposal-1" }),
			_Selection(2, { declaration: resultReady.steps[0]!.selection!.declaration }),
		])
			expect(function () { _ReduceConversationComputerTurnProtocol(second, { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection }, _BUDGET); }).toThrow();
	});

	it("rejects reuse of a private result exchange across steps", function ()
	{
		const first = _ToolCycle();
		const reserved = _ReduceConversationComputerTurnProtocol(first, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(first, { authorityExpiresAtEpochMs: 1_840_000_000_000 }) }, _BUDGET);
		const selected = _ReduceConversationComputerTurnProtocol(reserved, { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection: _Selection(2) }, _BUDGET);
		expect(function ()
		{
			_ReduceConversationComputerTurnProtocol(selected, { kind: ConversationComputerTurnProtocolEvents.ToolResultRecorded, result: _Result(2, { exchange: first.steps[0]!.result!.exchange, authorityExpiresAtEpochMs: 1_830_000_000_000 }) }, _BUDGET);
		}).toThrow();
	});

	it("rejects a tool selection that leaves no final model allowance", function ()
	{
		const budget = { ..._BUDGET, maxModelTurns: 1 };
		const open = _InitialConversationComputerTurnProtocol();
		expect(function ()
		{
			_ReduceConversationComputerTurnProtocol(open, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(open) }, budget);
		}).toThrow("final model allowance");
	});

	it("makes cancellation terminal from an in-progress step", function ()
	{
		const open = _InitialConversationComputerTurnProtocol();
		const reserved = _ReduceConversationComputerTurnProtocol(open, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(open) }, _BUDGET);
		const cancelled = _ReduceConversationComputerTurnProtocol(reserved, { kind: ConversationComputerTurnProtocolEvents.Cancelled, receipt: { commandId: "10000000-0000-4000-8000-000000000001", commandDigest: _DIGEST_A, occurredAt: "2026-09-14T12:00:00.000Z" } }, _BUDGET);
		expect(cancelled.state).toBe(ConversationComputerTurnProtocolStates.Cancelled);
		expect(function () { _ReduceConversationComputerTurnProtocol(cancelled, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(cancelled) }, _BUDGET); }).toThrow();
	});

	it("retains spent allowance when a saved model response becomes unavailable", function ()
	{
		const open = _InitialConversationComputerTurnProtocol();
		const reserved = _ReduceConversationComputerTurnProtocol(open, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _Reservation(open) }, _BUDGET);
		const unavailable = _ReduceConversationComputerTurnProtocol(reserved, { kind: ConversationComputerTurnProtocolEvents.ResponseUnavailable, receipt: { ordinal: 1, sourceCommandId: reserved.steps[0]!.reservation.invocationFence, reason: ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable } }, _BUDGET);
		expect(unavailable.state).toBe(ConversationComputerTurnProtocolStates.ResponseUnavailable);
		expect(unavailable.accounting).toEqual(reserved.accounting);
		expect(function () { _ReduceConversationComputerTurnProtocol(unavailable, { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection: _Selection() }, _BUDGET); }).toThrow();
	});
});
