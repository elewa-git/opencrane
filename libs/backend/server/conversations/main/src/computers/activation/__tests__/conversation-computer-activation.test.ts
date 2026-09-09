import { describe, expect, it, vi } from "vitest";

import { __ConsumeConversationComputerActivation, __RunConversationComputerActivationListener, _ActivationRetryDelayMilliseconds } from "../conversation-computer-activation";

function _Delivery(overrides: Record<string, unknown> = {})
{
	return { id: "activation-1", streamName: "computer-activations-silo-1", type: "opencrane.computer.activation-requested.v1", data: { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 }, metadata: {}, revision: 4n, recordedAt: new Date("2026-08-31T00:00:00.000Z"), retryCount: 0, ...overrides };
}

describe("ConversationComputer activation consumer", function ()
{
	it("acknowledges an activated or current denial after validating its silo queue", async function ()
	{
		const acknowledge = vi.fn().mockResolvedValue(undefined);
		const authority = { activate: vi.fn().mockResolvedValue("denied") };

		await __ConsumeConversationComputerActivation({ acknowledge, park: vi.fn(), retry: vi.fn() }, authority, _Delivery());

		expect(authority.activate).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 });
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
		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ data: { siloId: "", computerId: "computer-1", conversationId: "conversation-1", generation: 2 } }), { wait });
		expect(park).toHaveBeenCalledTimes(2);
		expect(wait).not.toHaveBeenCalled();
		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park, retry }, unavailable, _Delivery({ retryCount: 3 }), { wait });
		expect(wait).toHaveBeenCalledWith(8_000, undefined);
		expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: "activation-1" }), "conversation computer activation authority unavailable");
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

		expect(park).toHaveBeenCalledWith(expect.objectContaining({ id: "activation-1" }), "computer profile is invalid");
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
		const second = _Delivery({ id: "activation-2", data: { siloId: "silo-1", computerId: "computer-2", conversationId: "conversation-1", generation: 3 } });
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
