import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationModelPreForwardContracts, ConversationModelPreForwardReasons, ConversationModelResponseKinds, type ConversationModelRequest, type ConversationModelResponse } from "@opencrane/contracts";

import { _OutputRecoveryHarness } from "./conversation-output-recovery.fixture";
import { _ToolContinuationHarness } from "./conversation-tool-continuation.fixture";
import { ConversationComputerTurnProtocolStates } from "../conversation-computer-turn-protocol.types";
import { _CONVERSATION_MODEL_REJECTED_EVENT, _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT } from "../conversation-computer-model-retry-store";

const _NOW = Date.parse("2026-09-22T12:00:00.000Z");
const _BODY_DIGEST = "c".repeat(64);

/** Represents a transport-authenticated rejection; cryptographic verification is tested by its owner. */
function _rejection(input: ConversationModelRequest): ConversationModelResponse
{
	return { kind: ConversationModelResponseKinds.PreForwardRejected, receipt: {
		version: ConversationModelPreForwardContracts.V1, reason: ConversationModelPreForwardReasons.LocalRateLimit,
		physicalNonce: input.delivery!.physicalNonce, logicalFence: input.delivery!.logicalFence,
		requestBodySha256: _BODY_DIGEST, deadlineEpochMs: input.notAfterEpochMs, retryAtEpochMs: Date.now() + 1_000,
	} };
}

/** Records a turn-owned Stop using the same append builder as the Stop publisher. */
async function _stop(fixture: Awaited<ReturnType<typeof _OutputRecoveryHarness>>): Promise<void>
{
	const turn = (await fixture.store.load(fixture.output.bootstrapId))!;
	const appends = fixture.store.cancellationAppends(turn, { commandId: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651", commandDigest: `sha256:${"e".repeat(64)}`, occurredAt: new Date().toISOString() }, 0n);
	await fixture.history.appendAtomic({ expectedHeads: appends.map(append => ({ streamName: append.streamName, revision: append.expectedRevision })), appends });
}

beforeEach(function _clock() { vi.useFakeTimers(); vi.setSystemTime(_NOW); });
afterEach(function _cleanup() { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("saved model retry orchestration", function _suite()
{
	it("resumes a saved rejection after restart with the same key, body, budget and deadline", async function _restartWait()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		const first = await f.authority.advance(f.output.bootstrapId);
		expect(first).toEqual({ outcome: "model_retry_waiting", notBeforeEpochMs: _NOW + 1_000, ordinal: 1, retryOrdinal: 1 });
		const waiting = (await f.store.load(f.output.bootstrapId))!;
		expect(waiting.protocol.state).toBe(ConversationComputerTurnProtocolStates.ModelRetryWaiting);
		expect(waiting.protocol.accounting).toEqual({ reservedModelCalls: 1, reservedCompletionTokens: 100, reservedToolInvocations: 0, toolResultCyclesFed: 0 });
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual(first);
		expect(f.credentials.reuseExact).not.toHaveBeenCalled();
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
		expect(f.credentials.reuseExact).toHaveBeenCalledTimes(1);
		const original = f.model.request.mock.calls[0]![0] as ConversationModelRequest;
		const retry = f.model.request.mock.calls[1]![0] as ConversationModelRequest;
		expect({ ...retry, delivery: undefined }).toEqual({ ...original, delivery: undefined });
		expect(retry.delivery).toMatchObject({ logicalFence: original.delivery!.logicalFence, expectedRequestBodySha256: _BODY_DIGEST });
		expect(retry.delivery!.physicalNonce).not.toBe(original.delivery!.physicalNonce);
		const completed = (await f.store.load(f.output.bootstrapId))!;
		expect(completed.protocol.steps).toHaveLength(1);
		expect(completed.protocol.accounting).toEqual(waiting.protocol.accounting);
		expect(JSON.stringify([...f.history.streams.values()], function _json(_key, value) { return typeof value === "bigint" ? String(value) : value; })).not.toContain("test-only-key");
	});

	it("permits two separately saved retry claims and does not debit a new logical model call", async function _twoRejections()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection).mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_retry_waiting", retryOrdinal: 2, notBeforeEpochMs: _NOW + 2_000 });
		vi.setSystemTime(_NOW + 2_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		expect(f.model.request).toHaveBeenCalledTimes(3);
		expect(new Set(f.model.request.mock.calls.map(call => call[0].delivery.physicalNonce)).size).toBe(3);
		expect(f.model.request.mock.calls.every(call => call[0].notAfterEpochMs === _NOW + 25_000)).toBe(true);
		expect((await f.store.load(f.output.bootstrapId))!.protocol.accounting.reservedModelCalls).toBe(1);
	});

	it("saves a third rejection as exhausted and never sends a fourth request", async function _exhausted()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementation(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		vi.setSystemTime(_NOW + 1_000); await f.authority.advance(f.output.bootstrapId);
		vi.setSystemTime(_NOW + 2_000);
		await expect(f.authority.advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "response_unavailable" });
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "response_unavailable" });
		expect(f.model.request).toHaveBeenCalledTimes(3);
		expect((await f.store.load(f.output.bootstrapId))!.protocol.modelRetry!.rejections).toHaveLength(3);
		expect(f.runLifecycle.enterRecoveryRequired).toHaveBeenCalled();
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
	});

	it("recovers a lost receipt acknowledgement but still requires a new saved claim", async function _lostReceiptAck()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		f.history.afterAppend = async function _loseAck(command)
		{
			if (command.events.some(event => event.type === _CONVERSATION_MODEL_REJECTED_EVENT))
				throw new Error("synthetic lost receipt acknowledgement");
		};
		await expect(f.authority.advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_retry_waiting" });
		expect(f.model.request).toHaveBeenCalledTimes(1);
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "completed" });
		const events = f.history.streams.get(`conversation-computer-turn-${f.output.bootstrapId}`)!;
		expect(events.filter(event => event.type === _CONVERSATION_MODEL_REJECTED_EVENT)).toHaveLength(1);
		expect(events.filter(event => event.type === _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT)).toHaveLength(1);
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("never dispatches after a lost retry-claim acknowledgement", async function _lostClaimAck()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		f.history.afterAppend = async function _loseClaim(command)
		{
			if (command.events.some(event => event.type === _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT))
				throw new Error("synthetic lost claim acknowledgement");
		};
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.authority.advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_pending", notBeforeEpochMs: _NOW + 25_000 });
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_pending" });
		vi.setSystemTime(_NOW + 25_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "response_unavailable" });
		expect(f.model.request).toHaveBeenCalledTimes(1);
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
	});

	it("allows only one of two simultaneous workflow claimants to send", async function _competingWorkers()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		vi.setSystemTime(_NOW + 1_000);
		await Promise.all([f.restart().advance(f.output.bootstrapId), f.restart().advance(f.output.bootstrapId)]);
		expect(f.model.request).toHaveBeenCalledTimes(2);
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
		expect((await f.store.load(f.output.bootstrapId))!.protocol.output).not.toBeNull();
	});

	it.each(["before-claim", "after-claim"])("honours Stop %s without another model send", async function _stopped(position)
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		if (position === "before-claim")
			await _stop(f);
		else
			f.history.afterAppend = async function _stopAfterClaim(command)
			{
				if (command.events.some(event => event.type === _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT))
					await _stop(f);
			};
		vi.setSystemTime(_NOW + 1_000);
		await f.restart().advance(f.output.bootstrapId);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "authority_ended" });
		expect(f.model.request).toHaveBeenCalledTimes(1);
	});

	it("checks current permission again after the wait", async function _revoked()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		f.flags.mayAppend = false;
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "authority_ended" });
		expect(f.credentials.reuseExact).not.toHaveBeenCalled();
		expect(f.model.request).toHaveBeenCalledTimes(1);
	});

	it("refuses replacement credential material without minting or dispatch", async function _changedCredential()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection);
		await f.authority.advance(f.output.bootstrapId);
		f.credentials.reuseExact.mockResolvedValue({ key: "changed-key", credentialDigest: `sha256:${"f".repeat(64)}`, expiresAt: "2099-01-01T00:00:00.000Z" });
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "retry" });
		expect(f.model.request).toHaveBeenCalledTimes(1);
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
	});

	it("does not replay a retry whose model response is then lost", async function _lostResponse()
	{
		const f = await _OutputRecoveryHarness(false);
		f.model.request.mockImplementationOnce(_rejection).mockRejectedValueOnce(new Error("synthetic lost model response"));
		await f.authority.advance(f.output.bootstrapId);
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.authority.advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_pending" });
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toMatchObject({ outcome: "model_pending" });
		vi.setSystemTime(_NOW + 25_000);
		await expect(f.restart().advance(f.output.bootstrapId)).resolves.toEqual({ outcome: "response_unavailable" });
		expect(f.model.request).toHaveBeenCalledTimes(2);
	});

	it("preserves the earlier encrypted tool result when a later model step is rejected", async function _laterModelRetry()
	{
		const f = await _ToolContinuationHarness(1);
		f.model.request.mockImplementationOnce(async function _tool() { return { kind: ConversationModelResponseKinds.Tool, call: f.call }; }).mockImplementationOnce(_rejection);
		await expect(f.authority.advance(f.step)).resolves.toMatchObject({ outcome: "model_retry_waiting", ordinal: 2 });
		const before = (await f.store.load(f.step))!;
		vi.setSystemTime(_NOW + 1_000);
		await expect(f.restart().advance(f.step)).resolves.toEqual({ outcome: "completed" });
		expect(f.model.request.mock.calls[1]![0].history).toEqual(f.model.request.mock.calls[2]![0].history);
		expect(f.model.request.mock.calls[2]![0].history).toHaveLength(1);
		expect(f.toolFlags.executions).toBe(1);
		expect(f.toolFlags.acknowledgements).toBe(1);
		expect(f.credentials.issueOnce).toHaveBeenCalledTimes(1);
		expect((await f.store.load(f.step))!.protocol.accounting).toEqual(before.protocol.accounting);
	});
});
