import { ConversationModelToolModes } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _ConversationModelInitialNonce, _ConversationModelLogicalFence } from "../conversation-computer-model-retry";
import type { ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "../conversation-computer-model-retry.types";
import { _ConversationComputerTurnHistoryDigest, _ReduceConversationComputerTurnProtocol } from "../conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolEvents as Events, ConversationComputerTurnProtocolStates as States, ConversationComputerTurnUnavailableReasons } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnProtocolEvent, ConversationComputerTurnProtocolProjection } from "../conversation-computer-turn-protocol.types";
import { _Claim, _DIGEST, _NOW, _Rejection, _Reservation, _ReservedProtocol, _TURN } from "./conversation-computer-model-retry.fixture";

function _Apply(protocol: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent)
{
	return _ReduceConversationComputerTurnProtocol(protocol, event, _TURN.budget);
}

function _Waiting()
{
	return _Apply(_ReservedProtocol(), { kind: Events.ModelRejected, rejection: _Rejection() });
}

describe("bounded model retry protocol", function ()
{
	it("domain-separates first physical nonce and logical fence across every reservation field", function ()
	{
		const reservation = _Reservation();
		expect(_ConversationModelInitialNonce(reservation)).toMatch(/^[0-9a-f]{64}$/u);
		expect(_ConversationModelInitialNonce(reservation)).not.toBe(_ConversationModelLogicalFence(reservation));
		for (const [key, value] of Object.entries(reservation))
		{
			const changed = { ...reservation, [key]: typeof value === "number" ? value + 1 : `${value}-changed` };
			expect(_ConversationModelInitialNonce(changed)).not.toBe(_ConversationModelInitialNonce(reservation));
			expect(_ConversationModelLogicalFence(changed)).not.toBe(_ConversationModelLogicalFence(reservation));
		}
	});

	it("preserves allowance, reservation and history across two claims and a final exhausted rejection", function ()
	{
		const reserved = _ReservedProtocol();
		let current = _Waiting();
		for (const ordinal of [1, 2])
		{
			current = _Apply(current, { kind: Events.ModelRetryClaimed, claim: _Claim(ordinal) });
			expect(current.state).toBe(States.ModelReserved);
			current = _Apply(current, { kind: Events.ModelRejected, rejection: _Rejection(_Claim(ordinal).physicalNonce, ordinal * 1_000) });
		}
		expect(current.state).toBe(States.ModelRetryWaiting);
		expect(current.modelRetry?.rejections).toHaveLength(3);
		expect(current.modelRetry?.claim).toEqual(_Claim(2));
		expect(current.accounting).toEqual(reserved.accounting);
		expect(current.steps).toEqual(reserved.steps);
		expect(_ConversationComputerTurnHistoryDigest(current.steps)).toBe(_ConversationComputerTurnHistoryDigest(reserved.steps));
		expect(function () { _Apply(current, { kind: Events.ModelRetryClaimed, claim: _Claim(3) }); }).toThrow();
	});

	it("requires a new acknowledged claim between every rejection", function ()
	{
		const waiting = _Waiting();
		expect(function () { _Apply(waiting, { kind: Events.ModelRejected, rejection: _Rejection() }); }).toThrow();
		expect(function () { _Apply(_ReservedProtocol(), { kind: Events.ModelRetryClaimed, claim: _Claim() }); }).toThrow();
		const claimed = _Apply(waiting, { kind: Events.ModelRetryClaimed, claim: _Claim() });
		expect(function () { _Apply(claimed, { kind: Events.ModelRejected, rejection: _Rejection() }); }).toThrow();
	});

	it("rejects a changed first physical request, credential expiry, fence or deadline", function ()
	{
		const initial = _Rejection();
		const candidates: ConversationComputerModelRejection[] = [
			{ ...initial, receipt: { ...initial.receipt, physicalNonce: "e".repeat(64) } },
			{ ...initial, receipt: { ...initial.receipt, logicalFence: "e".repeat(64) } },
			{ ...initial, receipt: { ...initial.receipt, deadlineEpochMs: _NOW + 26_000 } },
			{ ...initial, receipt: { ...initial.receipt, retryAtEpochMs: _NOW + 25_000 } },
			{ ...initial, credentialDigest: "raw-secret" },
			{ ...initial, credentialExpiresAt: new Date(_NOW + 24_999).toISOString() },
			{ ...initial, receivedAtEpochMs: _NOW + 25_000 },
		];
		for (const rejection of candidates)
			expect(function () { _Apply(_ReservedProtocol(), { kind: Events.ModelRejected, rejection }); }).toThrow();
	});

	it("rejects changed request bytes, credentials and pre-claim timestamps on a later rejection", function ()
	{
		const claimed = _Apply(_Waiting(), { kind: Events.ModelRetryClaimed, claim: _Claim() });
		const initial = _Rejection(_Claim().physicalNonce, 1_000);
		const candidates: ConversationComputerModelRejection[] = [
			{ ...initial, receipt: { ...initial.receipt, requestBodySha256: "e".repeat(64) } },
			{ ...initial, credentialDigest: `sha256:${"e".repeat(64)}` },
			{ ...initial, credentialExpiresAt: new Date(_NOW + 301_000).toISOString() },
			{ ...initial, receivedAtEpochMs: _NOW + 999 },
			{ ...initial, receipt: { ...initial.receipt, retryAtEpochMs: _NOW + 999 } },
		];
		for (const rejection of candidates)
			expect(function () { _Apply(claimed, { kind: Events.ModelRejected, rejection }); }).toThrow();
	});

	it("rejects early, expired, reused, skipped or foreign claims", function ()
	{
		const claim = _Claim();
		const candidates: ConversationComputerModelRetryClaim[] = [
			{ ...claim, claimedAtEpochMs: _NOW + 999 }, { ...claim, claimedAtEpochMs: _NOW + 25_000 },
			{ ...claim, physicalNonce: _Rejection().receipt.physicalNonce }, { ...claim, retryOrdinal: 2 },
			{ ...claim, ordinal: 2 }, { ...claim, modelInvocationFence: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651" },
			{ ...claim, physicalNonce: "A".repeat(64) },
		];
		for (const candidate of candidates)
			expect(function () { _Apply(_Waiting(), { kind: Events.ModelRetryClaimed, claim: candidate }); }).toThrow();
	});

	it("allows a slow receipt only after both its arrival and already-passed reset", function ()
	{
		const rejection = { ..._Rejection(), receivedAtEpochMs: _NOW + 2_000 };
		const waiting = _Apply(_ReservedProtocol(), { kind: Events.ModelRejected, rejection });
		expect(function () { _Apply(waiting, { kind: Events.ModelRetryClaimed, claim: _Claim() }); }).toThrow();
		expect(_Apply(waiting, { kind: Events.ModelRetryClaimed, claim: { ..._Claim(), claimedAtEpochMs: _NOW + 2_000 } }).state).toBe(States.ModelReserved);
	});

	it("allows only a claim, Stop or unavailable decision while waiting", function ()
	{
		const waiting = _Waiting();
		for (const kind of [Events.ModelReserved, Events.ModelRejected, Events.ToolSelected, Events.ToolResultRecorded, Events.OutputRecorded])
			expect(function () { _Apply(waiting, { kind } as ConversationComputerTurnProtocolEvent); }).toThrow();
		const unavailable = _Apply(waiting, { kind: Events.ResponseUnavailable, receipt: { ordinal: 1, sourceCommandId: _Reservation().invocationFence, reason: ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable } });
		const cancelled = _Apply(waiting, { kind: Events.Cancelled, receipt: { commandId: "stop-1", commandDigest: _DIGEST, occurredAt: new Date(_NOW).toISOString() } });
		for (const terminal of [unavailable, cancelled])
		{
			expect(terminal.accounting).toEqual(waiting.accounting);
			expect(function () { _Apply(terminal, { kind: Events.ModelRetryClaimed, claim: _Claim() }); }).toThrow();
		}
	});

	it("clears only current-step retry evidence when a later logical reservation is admitted", function ()
	{
		const claimed = _Apply(_Waiting(), { kind: Events.ModelRetryClaimed, claim: _Claim() });
		const selection = { ordinal: 1, modelInvocationFence: _Reservation().invocationFence, declaration: { payloadRef: "declaration-1", ciphertextDigest: _DIGEST }, proposalId: "proposal-1", toolInvocationId: "proposal-1", requestFingerprint: _DIGEST };
		const selected = _Apply(claimed, { kind: Events.ToolSelected, selection });
		const ready = _Apply(selected, { kind: Events.ToolResultRecorded, result: { ordinal: 1, proposalId: "proposal-1", toolInvocationId: "proposal-1", resultDigest: _DIGEST, exchange: { payloadRef: "exchange-1", ciphertextDigest: _DIGEST }, authorityExpiresAtEpochMs: _NOW + 30_000 } });
		const next = _Apply(ready, { kind: Events.ModelReserved, reservation: { ..._Reservation(), ordinal: 2, invocationFence: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651", tools: ConversationModelToolModes.None, authorityExpiresAtEpochMs: _NOW + 30_000, historyDigest: _ConversationComputerTurnHistoryDigest(ready.steps) } });
		expect(next.modelRetry).toBeNull();
		expect(next.accounting).toEqual({ reservedModelCalls: 2, reservedCompletionTokens: 200, reservedToolInvocations: 1, toolResultCyclesFed: 1 });
	});
});
