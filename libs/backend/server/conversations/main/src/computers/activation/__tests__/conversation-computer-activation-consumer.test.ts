import type { HistoryPersistentRecordedEvent, HistoryPersistentSubscription } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { __ConsumeConversationComputerActivation, __StartConversationComputerActivationConsumer, _DEFAULT_RESUBSCRIBE_POLICY, _ResubscribeDelayMilliseconds } from "../conversation-computer-activation";
import { ConversationComputerActivationConsumerEventKinds, ConversationComputerActivationConsumerStates, type ConversationComputerActivationConsumerEvent } from "../conversation-computer-activation.types";

/** One valid activation delivery. */
function _Delivery(id = "11111111-1111-4111-8111-111111111111"): HistoryPersistentRecordedEvent
{
	return { id, streamName: "computer-activations-silo-1", type: "opencrane.computer.activation-requested.v1", data: { action: "start", siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 1, causationPosition: "1" }, metadata: { causationId: "22222222-2222-4222-8222-222222222222" }, revision: 0n, recordedAt: new Date("2026-09-06T00:00:00.000Z"), retryCount: 0 };
}

/** A hand-driven persistent subscription: the test pushes deliveries, ends it, or fails it. */
function _Subscription()
{
	type Item = IteratorResult<HistoryPersistentRecordedEvent> | { readonly error: unknown };
	const queue: Item[] = [];
	const waiters: Array<(item: Item) => void> = [];
	function deliver(item: Item): void
	{
		const waiter = waiters.shift();
		if (waiter)
			waiter(item);
		else
			queue.push(item);
	}
	async function next(): Promise<IteratorResult<HistoryPersistentRecordedEvent>>
	{
		const item = queue.shift() ?? await new Promise<Item>(function _Await(resolve) { waiters.push(resolve); });
		if ("error" in item)
			throw item.error;
		return item;
	}
	const events: AsyncIterable<HistoryPersistentRecordedEvent> = { [Symbol.asyncIterator]() { return { next }; } };
	const subscription: HistoryPersistentSubscription = { events, acknowledge: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined), park: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
	return { subscription, push(delivery: HistoryPersistentRecordedEvent) { deliver({ done: false, value: delivery }); }, end() { deliver({ done: true, value: undefined }); }, fail(error: unknown) { deliver({ error }); } };
}

/** Records every consumer observation in order. */
function _Events()
{
	const events: ConversationComputerActivationConsumerEvent[] = [];
	return { events, onEvent: function _OnEvent(event: ConversationComputerActivationConsumerEvent) { events.push(event); }, kinds() { return events.map(event => event.kind); } };
}

/** Wait that resolves right away unless the test aborts it first; records requested durations. */
const _instantWait = vi.fn(async function _InstantWait(_milliseconds: number, _signal?: AbortSignal) {});

describe("supervised conversation computer activation consumer", function _Suite()
{
	it("reopens the subscription after a drop and keeps handling deliveries", async function _Resubscribes()
	{
		const first = _Subscription();
		const second = _Subscription();
		const open = vi.fn().mockResolvedValueOnce(first.subscription).mockResolvedValueOnce(second.subscription);
		const authority = { activate: vi.fn().mockResolvedValue("activated" as const) };
		const observed = _Events();
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(open, authority, { signal: stop.signal, onEvent: observed.onEvent, wait: _instantWait, random: () => 0.5 });
		first.push(_Delivery("11111111-1111-4111-8111-111111111111"));
		await vi.waitFor(function _FirstAcknowledged() { expect(first.subscription.acknowledge).toHaveBeenCalledOnce(); });
		first.fail(new Error("connection reset"));
		await vi.waitFor(function _SecondOpen() { expect(open).toHaveBeenCalledTimes(2); });
		expect(first.subscription.close).toHaveBeenCalledOnce();
		expect(consumer.health()).toEqual({ state: ConversationComputerActivationConsumerStates.Subscribed, consecutiveFailures: 1 });
		second.push(_Delivery("33333333-3333-4333-8333-333333333333"));
		await vi.waitFor(function _SecondAcknowledged() { expect(second.subscription.acknowledge).toHaveBeenCalledOnce(); });
		stop.abort();
		await consumer.done;

		expect(observed.kinds()).toEqual([ConversationComputerActivationConsumerEventKinds.Subscribed, ConversationComputerActivationConsumerEventKinds.Dropped, ConversationComputerActivationConsumerEventKinds.Subscribed, ConversationComputerActivationConsumerEventKinds.Stopped]);
		expect(observed.events[1]).toMatchObject({ consecutiveFailures: 1, nextWaitMilliseconds: 1_000 });
		expect(second.subscription.close).toHaveBeenCalledOnce();
		expect(consumer.health().state).toBe(ConversationComputerActivationConsumerStates.Stopped);
	});

	it("treats an ended stream and a failed queue action as drops", async function _EndedAndActionFailure()
	{
		const first = _Subscription();
		const second = _Subscription();
		const third = _Subscription();
		const open = vi.fn().mockResolvedValueOnce(first.subscription).mockResolvedValueOnce(second.subscription).mockResolvedValueOnce(third.subscription);
		(second.subscription.acknowledge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ack channel closed"));
		const observed = _Events();
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(open, { activate: vi.fn().mockResolvedValue("denied" as const) }, { signal: stop.signal, onEvent: observed.onEvent, wait: _instantWait });
		first.end();
		await vi.waitFor(function _SecondOpen() { expect(open).toHaveBeenCalledTimes(2); });
		second.push(_Delivery());
		await vi.waitFor(function _ThirdOpen() { expect(open).toHaveBeenCalledTimes(3); });
		stop.abort();
		await consumer.done;

		const dropped = observed.events.filter(event => event.kind === ConversationComputerActivationConsumerEventKinds.Dropped);
		expect(dropped.map(event => (event as { error: Error }).error.message)).toEqual(["conversation computer activation subscription ended", "ack channel closed"]);
		expect(second.subscription.close).toHaveBeenCalledOnce();
	});

	it("reports Failed and stops reopening once the consecutive-failure budget is used", async function _Budget()
	{
		const open = vi.fn().mockRejectedValue(new Error("kurrentdb unreachable"));
		const observed = _Events();
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(open, { activate: vi.fn() }, { signal: stop.signal, onEvent: observed.onEvent, wait: _instantWait, resubscribe: { maxConsecutiveFailures: 3 } });
		await consumer.done;

		expect(open).toHaveBeenCalledTimes(3);
		expect(consumer.health()).toEqual({ state: ConversationComputerActivationConsumerStates.Failed, consecutiveFailures: 3 });
		expect(observed.kinds()).toEqual([ConversationComputerActivationConsumerEventKinds.Dropped, ConversationComputerActivationConsumerEventKinds.Dropped, ConversationComputerActivationConsumerEventKinds.Failed]);
		expect(observed.events[2]).toMatchObject({ error: expect.objectContaining({ message: "kurrentdb unreachable" }), consecutiveFailures: 3 });
	});

	it("clears the failure count after a session that stayed open for the healthy duration", async function _HealthyReset()
	{
		const sessions = [_Subscription(), _Subscription(), _Subscription()];
		const open = vi.fn().mockResolvedValueOnce(sessions[0]!.subscription).mockResolvedValueOnce(sessions[1]!.subscription).mockResolvedValueOnce(sessions[2]!.subscription);
		let clock = 0;
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(open, { activate: vi.fn() }, { signal: stop.signal, wait: _instantWait, now: () => clock, resubscribe: { maxConsecutiveFailures: 2, healthySessionMilliseconds: 60_000 } });
		sessions[0]!.fail(new Error("first drop"));
		await vi.waitFor(function _SecondOpen() { expect(open).toHaveBeenCalledTimes(2); });
		expect(consumer.health().consecutiveFailures).toBe(1);
		clock += 60_000;
		sessions[1]!.fail(new Error("second drop after a healthy hour"));
		await vi.waitFor(function _ThirdOpen() { expect(open).toHaveBeenCalledTimes(3); });
		expect(consumer.health()).toEqual({ state: ConversationComputerActivationConsumerStates.Subscribed, consecutiveFailures: 1 });
		stop.abort();
		await consumer.done;

		expect(consumer.health().state).toBe(ConversationComputerActivationConsumerStates.Stopped);
	});

	it("hands an in-flight delivery back to the group on shutdown before closing the subscription", async function _ShutdownNacks()
	{
		const session = _Subscription();
		const pending = { action: "retry", reason: "Agent Sandbox has not assigned the conversation computer yet" } as const;
		const abortableWait = vi.fn(function _AbortableWait(_milliseconds: number, signal?: AbortSignal)
		{
			return new Promise<void>(function _UntilAbort(resolve)
			{
				if (signal?.aborted)
				{
					resolve();
					return;
				}
				signal?.addEventListener("abort", function _Aborted() { resolve(); }, { once: true });
			});
		});
		const observed = _Events();
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(vi.fn().mockResolvedValue(session.subscription), { activate: vi.fn().mockResolvedValue(pending) }, { signal: stop.signal, onEvent: observed.onEvent, wait: abortableWait });
		session.push(_Delivery());
		await vi.waitFor(function _Waiting() { expect(abortableWait).toHaveBeenCalledOnce(); });
		expect(session.subscription.retry).not.toHaveBeenCalled();
		stop.abort();
		await consumer.done;

		expect(session.subscription.retry).toHaveBeenCalledWith(expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }), pending.reason);
		expect((session.subscription.retry as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan((session.subscription.close as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
		expect(session.subscription.acknowledge).not.toHaveBeenCalled();
		expect(observed.kinds()).toEqual([ConversationComputerActivationConsumerEventKinds.Subscribed, ConversationComputerActivationConsumerEventKinds.Stopped]);
	});

	it("stops an idle consumer without waiting for a delivery that never comes", async function _IdleStop()
	{
		const session = _Subscription();
		const stop = new AbortController();

		const consumer = __StartConversationComputerActivationConsumer(vi.fn().mockResolvedValue(session.subscription), { activate: vi.fn() }, { signal: stop.signal });
		await vi.waitFor(function _Subscribed() { expect(consumer.health().state).toBe(ConversationComputerActivationConsumerStates.Subscribed); });
		stop.abort();
		await consumer.done;

		expect(session.subscription.close).toHaveBeenCalledOnce();
		expect(consumer.health().state).toBe(ConversationComputerActivationConsumerStates.Stopped);
	});

	it("skips the real retry wait once shutdown has started", async function _RealWaitAborts()
	{
		const retry = vi.fn().mockResolvedValue(undefined);
		const stop = new AbortController();
		stop.abort();

		await __ConsumeConversationComputerActivation({ acknowledge: vi.fn(), park: vi.fn(), retry }, { activate: vi.fn().mockRejectedValue(new Error("database unavailable")) }, { ..._Delivery(), retryCount: 10 }, { signal: stop.signal });

		expect(retry).toHaveBeenCalledOnce();
	});

	it("spreads reopen waits with jitter under the cap", function _Delays()
	{
		expect(_ResubscribeDelayMilliseconds(1, _DEFAULT_RESUBSCRIBE_POLICY, () => 0.5)).toBe(1_000);
		expect(_ResubscribeDelayMilliseconds(3, _DEFAULT_RESUBSCRIBE_POLICY, () => 0)).toBe(3_000);
		expect(_ResubscribeDelayMilliseconds(3, _DEFAULT_RESUBSCRIBE_POLICY, () => 0.999)).toBeLessThan(5_000);
		expect(_ResubscribeDelayMilliseconds(20, _DEFAULT_RESUBSCRIBE_POLICY, () => 0.5)).toBe(30_000);
		expect(_ResubscribeDelayMilliseconds(Number.NaN, _DEFAULT_RESUBSCRIBE_POLICY, () => 0.5)).toBe(1_000);
	});
});
