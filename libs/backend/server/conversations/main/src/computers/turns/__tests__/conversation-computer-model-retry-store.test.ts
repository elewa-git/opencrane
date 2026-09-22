import { describe, expect, it } from "vitest";

import { ConversationComputerTurnProtocolStates, ConversationComputerTurnUnavailableReasons } from "../conversation-computer-turn-protocol.types";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import { _Claim, _NOW, _Rejection, _Reservation, _RetryFixture, _TURN, _WaitingFixture } from "./conversation-computer-model-retry.fixture";

describe("durable model retry ownership", function ()
{
	it("replays rejection and acknowledged claim without consuming another allowance", async function ()
	{
		const fixture = await _WaitingFixture();
		const before = await fixture.store.load(_TURN.bootstrapId);
		expect(await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim())).toBe(true);
		const restored = await new KurrentConversationComputerTurnStore(fixture.history as never).load(_TURN.bootstrapId);
		expect(restored?.protocol.state).toBe(ConversationComputerTurnProtocolStates.ModelReserved);
		expect(restored?.protocol.modelRetry).toEqual({ rejections: [_Rejection()], claim: _Claim() });
		expect(restored?.protocol.accounting).toEqual(before?.protocol.accounting);
		expect(restored?.protocol.steps).toEqual(before?.protocol.steps);
		expect(await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim())).toBe(false);
	});

	it.each([false, true])("allows one concurrent claim even when identical payloads are supplied: %s", async function (identical)
	{
		const fixture = await _WaitingFixture();
		const other = new KurrentConversationComputerTurnStore(fixture.history as never);
		const outcomes = await Promise.all([
			fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim()),
			other.claimModelRetry(_TURN.bootstrapId, identical ? _Claim() : { ..._Claim(), physicalNonce: "f".repeat(64) }),
		]);
		expect(outcomes.filter(Boolean)).toHaveLength(1);
		const appends = fixture.history.append.mock.calls.filter(([input]) => input.events[0]?.type.includes("model-retry-claimed"));
		expect(appends).toHaveLength(2);
		expect(appends[0]![0].events[0]!.id).not.toBe(appends[1]![0].events[0]!.id);
		expect(appends[0]![0].events[0]!.metadata["appendAttemptId"]).not.toBe(appends[1]![0].events[0]!.metadata["appendAttemptId"]);
	});

	it("does not recover dispatch permission after a committed claim loses its acknowledgement", async function ()
	{
		const fixture = await _WaitingFixture();
		const append = fixture.history.append.getMockImplementation()!;
		fixture.history.append.mockImplementationOnce(async function _LostAck(input)
		{
			await append(input);
			throw new Error("synthetic lost acknowledgement");
		});
		await expect(fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim())).rejects.toThrow("lost acknowledgement");
		expect((await fixture.store.load(_TURN.bootstrapId))?.protocol.modelRetry?.claim).toEqual(_Claim());
		expect(await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim())).toBe(false);
	});

	it("can recover a committed rejection after its acknowledgement is lost", async function ()
	{
		const fixture = _RetryFixture();
		await fixture.store.createOrRead(_TURN);
		await fixture.store.reserveModel(_TURN.bootstrapId, _Reservation());
		const append = fixture.history.append.getMockImplementation()!;
		fixture.history.append.mockImplementationOnce(async function _LostAck(input)
		{
			await append(input);
			throw new Error("synthetic lost acknowledgement");
		});
		await expect(fixture.store.recordModelRejection(_TURN.bootstrapId, _Rejection())).resolves.toBeUndefined();
		const count = fixture.history.append.mock.calls.length;
		await fixture.store.recordModelRejection(_TURN.bootstrapId, _Rejection());
		expect(fixture.history.append).toHaveBeenCalledTimes(count);
		expect((await fixture.store.load(_TURN.bootstrapId))?.protocol.state).toBe(ConversationComputerTurnProtocolStates.ModelRetryWaiting);
	});

	it("does not grant a claim when a terminal decision wins before readback", async function ()
	{
		const fixture = await _WaitingFixture();
		const append = fixture.history.append.getMockImplementation()!;
		fixture.history.append.mockImplementationOnce(async function _Superseded(input)
		{
			const result = await append(input);
			await fixture.store.markResponseUnavailable(_TURN.bootstrapId, { ordinal: 1, sourceCommandId: _Reservation().invocationFence, reason: ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable });
			return result;
		});
		expect(await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim())).toBe(false);
	});

	it.each(["id", "appendAttemptId", "metadata", "revision", "nonce", "extra-field"])("rejects modified claim event evidence: %s", async function (mutation)
	{
		const fixture = await _WaitingFixture();
		await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim());
		const stream = fixture.streams.get(`conversation-computer-turn-${_TURN.bootstrapId}`)!;
		const last = stream.at(-1)!;
		const changed = structuredClone(last);
		if (mutation === "id")
			stream[stream.length - 1] = { ...changed, id: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651" };
		else if (mutation === "appendAttemptId")
			changed.metadata["appendAttemptId"] = "51c1f1dc-0010-4f13-9c2f-d3841ffd6651";
		else if (mutation === "metadata")
			changed.metadata["leaseId"] = "foreign-lease";
		else if (mutation === "revision")
			stream[stream.length - 1] = { ...changed, revision: changed.revision + 1n };
		else if (mutation === "nonce")
			(changed.data["claim"] as Record<string, unknown>)["physicalNonce"] = "e".repeat(64);
		else
			changed.data["unexpected"] = true;
		if (mutation !== "id" && mutation !== "revision")
			stream[stream.length - 1] = changed;
		await expect(fixture.store.load(_TURN.bootstrapId)).rejects.toThrow();
	});

	it("rejects changed credentials or request bytes after the first claimed retry", async function ()
	{
		const fixture = await _WaitingFixture();
		await fixture.store.claimModelRetry(_TURN.bootstrapId, _Claim());
		const rejection = _Rejection(_Claim().physicalNonce, 1_000);
		await expect(fixture.store.recordModelRejection(_TURN.bootstrapId, { ...rejection, credentialExpiresAt: new Date(_NOW + 301_000).toISOString() })).rejects.toThrow();
		await expect(fixture.store.recordModelRejection(_TURN.bootstrapId, { ...rejection, receipt: { ...rejection.receipt, requestBodySha256: "e".repeat(64) } })).rejects.toThrow();
	});
});
