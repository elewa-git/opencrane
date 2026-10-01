import { describe, expect, it, vi } from "vitest";

import { __ConsumeConversationComputerActivation, __RunConversationComputerActivationListener, _ActivationRetryDelayMilliseconds } from "../conversation-computer-activation";

function _Delivery(overrides: Record<string, unknown> = {})
{
	return { id: "11111111-1111-4111-8111-111111111111", streamName: "computer-activations-silo-1", type: "opencrane.computer.activation-requested.v1", data: { action: "start", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2, causationPosition: "1" }, metadata: { causationId: "22222222-2222-4222-8222-222222222222" }, revision: 4n, recordedAt: new Date("2026-08-31T00:00:00.000Z"), retryCount: 0, ...overrides };
}

const _STOP_ENTRY = { schemaVersion: 1 as const, id: "22222222-2222-4222-8222-222222222222", conversationId: "conversation-1", position: "1", author: { kind: "human" as const, principalId: "principal-1", participantId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z", name: "Jente", avatarArtifactRevisionId: null }, provenance: "human-authored" as const, visibility: { audience: "conversation" as const }, runId: null, causationId: "22222222-2222-4222-8222-222222222222", correlationId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "22222222-2222-4222-8222-222222222222", occurredAt: "2026-09-11T08:00:00.000Z", attestation: null, kind: "message" as const, state: "completed" as const, blocks: [{ id: "block-1", kind: "text" as const, payloadRef: "payload-1", ciphertextDigest: "sha256:payload" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "stop" as const };

describe("ConversationComputer activation consumer", function ()
{
	it("routes Stop to its requester-bound authority without activating replacement work", async function _Stop()
	{
		const acknowledge = vi.fn();
		const activation = { activate: vi.fn() };
		const stop = { stop: vi.fn().mockResolvedValue({ status: "accepted" as const }) };
		const history = { read: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {}, entries: [_STOP_ENTRY] }) };

		await __ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry: vi.fn() }, activation, _Delivery({ data: { action: "stop", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2, causationPosition: "1" } }), { stop: { authority: stop, history } });

		expect(activation.activate).not.toHaveBeenCalled();
		expect(stop.stop).toHaveBeenCalledWith({ commandId: "11111111-1111-4111-8111-111111111111", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2, causationId: "22222222-2222-4222-8222-222222222222", causationPosition: "1", requester: { principalId: "principal-1", subjectId: "subject-1", issuer: "https://issuer.test", authenticatedAt: "2026-09-11T08:00:00.000Z" } });
		expect(acknowledge).toHaveBeenCalledOnce();
	});

	it("acknowledges a permanent Stop denial but retries a transport failure", async function _StopFailures()
	{
		const acknowledge = vi.fn();
		const retry = vi.fn();
		const wait = vi.fn();
		const activation = { activate: vi.fn() };
		const history = { read: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {}, entries: [_STOP_ENTRY] }) };
		const delivery = _Delivery({ data: { action: "stop", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2, causationPosition: "1" } });
		const denied = { stop: vi.fn().mockResolvedValue({ status: "denied" as const }) };

		await __ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry }, activation, delivery, { stop: { authority: denied, history }, wait });
		expect(denied.stop).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledOnce();
		expect(activation.activate).not.toHaveBeenCalled();
		expect(retry).not.toHaveBeenCalled();

		const unavailable = { stop: vi.fn().mockRejectedValue(new Error("transport unavailable")) };
		await __ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry }, activation, delivery, { stop: { authority: unavailable, history }, wait });
		expect(wait).toHaveBeenCalledWith(1_000, undefined);
		expect(retry).toHaveBeenCalledWith(delivery, "conversation computer Stop authority unavailable");
		expect(acknowledge).toHaveBeenCalledOnce();
		expect(activation.activate).not.toHaveBeenCalled();
	});

	it("acknowledges an activated or current denial after validating its silo queue", async function ()
	{
		const acknowledge = vi.fn().mockResolvedValue(undefined);
		const authority = { activate: vi.fn().mockResolvedValue("denied") };

		await __ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry: vi.fn() }, authority, _Delivery());

		expect(authority.activate).toHaveBeenCalledWith({ activationEventId: "11111111-1111-4111-8111-111111111111", causationId: "22222222-2222-4222-8222-222222222222", causationPosition: "1", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 });
		expect(acknowledge).toHaveBeenCalledOnce();
	});

	it("parks malformed records and retries transient authority failures after a wait", async function ()
	{
		const park = vi.fn().mockResolvedValue(undefined);
		const retry = vi.fn().mockResolvedValue(undefined);
		const wait = vi.fn().mockResolvedValue(undefined);
		const unavailable = { activate: vi.fn().mockRejectedValue(new Error("database unavailable")) };

		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ streamName: "computer-activations-silo-2" }), { wait });
		expect(unavailable.activate).not.toHaveBeenCalled();
		expect(park).toHaveBeenCalledOnce();
		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ data: { action: "start", siloId: "", computerId: "computer-1", conversationId: "conversation-1", generation: 2 } }), { wait });
		expect(park).toHaveBeenCalledTimes(2);
		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ metadata: {} }), { wait });
		expect(park).toHaveBeenCalledTimes(3);
		expect(wait).not.toHaveBeenCalled();
		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ retryCount: 3 }), { wait });
		expect(wait).toHaveBeenCalledWith(8_000, undefined);
		expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }), "conversation computer activation authority unavailable");
		expect(wait.mock.invocationCallOrder[0]).toBeLessThan(retry.mock.invocationCallOrder[0]!);
	});

	it("keeps a not-ready sandbox live with growing bounded waits until the authority activates", async function ()
	{
		const acknowledge = vi.fn().mockResolvedValue(undefined);
		const park = vi.fn().mockResolvedValue(undefined);
		const retry = vi.fn().mockResolvedValue(undefined);
		const wait = vi.fn().mockResolvedValue(undefined);
		const pending = { action: "retry", reason: "Agent Sandbox has not assigned the conversation computer yet" } as const;
		const authority = { activate: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue("activated") };

		for (const retryCount of [0, 1, 2])
			await __ConsumeConversationComputerActivation({ acknowledge, park, retry }, authority, _Delivery({ retryCount }), { wait });
		await __ConsumeConversationComputerActivation({ acknowledge, park, retry }, authority, _Delivery({ retryCount: 3 }), { wait });

		expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1_000, 2_000, 4_000]);
		expect(retry).toHaveBeenCalledTimes(3);
		expect(retry).toHaveBeenLastCalledWith(expect.objectContaining({ retryCount: 2 }), pending.reason);
		expect(acknowledge).toHaveBeenCalledOnce();
		expect(park).not.toHaveBeenCalled();
	});

	it("caps the retry wait far below the provisioned message timeout", function ()
	{
		expect(_ActivationRetryDelayMilliseconds(0)).toBe(1_000);
		expect(_ActivationRetryDelayMilliseconds(3)).toBe(8_000);
		expect(_ActivationRetryDelayMilliseconds(4)).toBe(10_000);
		expect(_ActivationRetryDelayMilliseconds(59)).toBe(10_000);
		expect(_ActivationRetryDelayMilliseconds(Number.NaN)).toBe(1_000);
	});

	it("parks only a terminal activation failure, without waiting or retrying it", async function ()
	{
		const park = vi.fn().mockResolvedValue(undefined);
		const retry = vi.fn().mockResolvedValue(undefined);
		const wait = vi.fn().mockResolvedValue(undefined);

		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, { activate: vi.fn().mockResolvedValue({ action: "park", reason: "computer profile is invalid" }) }, _Delivery(), { wait });

		expect(park).toHaveBeenCalledWith(expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }), "computer profile is invalid");
		expect(retry).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});

	it("leaves acknowledgement failure for the subscription to redeliver", async function ()
	{
		const acknowledge = vi.fn().mockRejectedValue(new Error("acknowledgement unavailable"));
		const retry = vi.fn().mockResolvedValue(undefined);

		await expect(__ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry }, { activate: vi.fn().mockResolvedValue("activated") }, _Delivery())).rejects.toThrow("acknowledgement unavailable");
		expect(retry).not.toHaveBeenCalled();
	});

	it("processes subscription deliveries sequentially", async function ()
	{
		const first = _Delivery();
		const second = _Delivery({ id: "33333333-3333-4333-8333-333333333333", data: { action: "start", siloId: "silo-1", computerId: "computer-2", conversationId: "conversation-1", generation: 3, causationPosition: "1" } });
		const activationOrder: string[] = [];
		const events = (async function* ()
		{
			yield first;
			yield second;
		})();

		await __RunConversationComputerActivationListener({ events, acknowledge: vi.fn().mockResolvedValue(undefined), park: vi.fn(), retry: vi.fn() }, { activate: vi.fn(async (command) =>
		{
			activationOrder.push(command.computerId);
			return "activated" as const;
		}) });

		expect(activationOrder).toEqual(["computer-1", "computer-2"]);
	});
});
