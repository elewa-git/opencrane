import { ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryPersistentRecordedEvent, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore, type HistoryStreamHead } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { __ConsumeConversationComputerActivation } from "../conversation-computer-activation";
import { ConversationComputerActivationAuthorityAdapter } from "../conversation-computer-activation-authority";
import { ConversationComputerHistory } from "../conversation-computers";

const _PROFILE_REVISION = `sha256:${"a".repeat(64)}`;
const _PROFILE = { profileRevisionId: _PROFILE_REVISION, profileName: "developer", warmPoolName: "developer-pool", namespace: "testv5-computers", leaseTtlMilliseconds: 3_600_000 };
const _COLD = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
const _STREAM = "conversation-computer-computer-one";
const _ASSIGNED = { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local" } as const;

/** In-memory KurrentDB stand-in that keeps the two rules the authority relies on: the revision fence and idempotent same-id appends. */
class _MemoryHistoryStore implements Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	/** Every appended event per stream, in revision order. */
	public readonly streams = new Map<string, HistoryRecordedEvent[]>();

	/** Yields a snapshot of the stream so a concurrent append cannot change the iteration. */
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		for (const event of [...(this.streams.get(request.streamName) ?? [])])
			yield event;
	}

	/** Reports the last revision or null for a missing stream. */
	public async readHead(streamName: string): Promise<HistoryStreamHead>
	{
		const events = this.streams.get(streamName) ?? [];
		return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) };
	}

	/** Appends at the expected head, accepts an exact same-id replay, and rejects every other stale write. */
	public async append(command: HistoryAppend): Promise<HistoryAppendReceipt>
	{
		const events = this.streams.get(command.streamName) ?? [];
		const head = events.length === 0 ? null : BigInt(events.length - 1);
		const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? null : command.expectedRevision;
		if (expected !== head)
		{
			// KurrentDB treats a write of the same event ids right after the expected position as already done.
			const start = expected === null ? 0 : Number(expected) + 1;
			const written = events.slice(start, start + command.events.length);
			if (written.length === command.events.length && written.every((event, index) => event.id === command.events[index]!.id))
				return { streamName: command.streamName, revision: BigInt(start + command.events.length - 1) };
			throw new Error("WrongExpectedVersion");
		}
		for (const event of command.events)
			events.push({ ...event, streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date() });
		this.streams.set(command.streamName, events);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	}
}

/** Seeds one cold computer at revision 0 so both consumers start from the same history. */
async function _SeededStore(): Promise<_MemoryHistoryStore>
{
	const store = new _MemoryHistoryStore();
	await new ConversationComputerHistory(store).append({ expectedRevision: HistoryExpectedRevisions.NoStream, eventId: "0a1b2c3d-0000-5000-8000-000000000001", computer: _COLD, lease: null });
	return store;
}

/** Builds one consumer: its own authority, projections spy, and subscription spies over a shared store. */
function _Consumer(store: Pick<HistoryStore, "append" | "readHead" | "readStream">, claims = { prepare: vi.fn().mockReturnValue({ ..._ASSIGNED, sandboxId: null, serviceFQDN: null }), claim: vi.fn().mockResolvedValue(_ASSIGNED), inspect: vi.fn(), renew: vi.fn(), release: vi.fn(), bind: vi.fn() })
{
	const projections = { resolve: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION }), publishActiveLease: vi.fn().mockResolvedValue(undefined) };
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, store, claims, _PROFILE);
	const subscription = { acknowledge: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined), park: vi.fn().mockResolvedValue(undefined) };
	return { authority, projections, subscription, claims };
}

/** One activation-requested delivery for generation 1 of the seeded computer. */
function _Delivery(retryCount = 0): HistoryPersistentRecordedEvent
{
	return { id: "activation-1", streamName: "computer-activations-silo-1", type: "opencrane.computer.activation-requested.v1", data: { siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 1 }, metadata: {}, revision: 0n, recordedAt: new Date(), retryCount };
}

/** Redelivers to a consumer until it acknowledges or parks, the way the persistent group would. */
async function _ConsumeUntilSettled(consumer: ReturnType<typeof _Consumer>): Promise<void>
{
	for (let retryCount = 0; retryCount < 5; retryCount += 1)
	{
		const retriesBefore = consumer.subscription.retry.mock.calls.length;
		await __ConsumeConversationComputerActivation(consumer.subscription, consumer.authority, _Delivery(retryCount), { wait: vi.fn().mockResolvedValue(undefined) });
		if (consumer.subscription.retry.mock.calls.length === retriesBefore)
			return;
	}
	throw new Error("delivery never settled");
}

/** Reads the projected lease coordinates every consumer published. */
function _PublishedLeases(...consumers: ReturnType<typeof _Consumer>[]): Array<{ leaseId: string; leaseGeneration: number }>
{
	return consumers.flatMap(consumer => consumer.projections.publishActiveLease.mock.calls.map(([command]) => ({ leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration })));
}

describe("competing conversation computer activation consumers", function _Suite()
{
	it("converge on one claim and one active lease when both handle the same delivery at once", async function _Interleaved()
	{
		const store = await _SeededStore();
		const first = _Consumer(store);
		const second = _Consumer(store, first.claims);

		await Promise.all([_ConsumeUntilSettled(first), _ConsumeUntilSettled(second)]);

		const events = store.streams.get(_STREAM)!;
		expect(events.map(event => (event.data["computer"] as { state: string }).state)).toEqual([ConversationComputerStates.Cold, ConversationComputerStates.ClaimPending, ConversationComputerStates.Warm]);
		expect(first.subscription.acknowledge).toHaveBeenCalledOnce();
		expect(second.subscription.acknowledge).toHaveBeenCalledOnce();
		expect(first.subscription.park).not.toHaveBeenCalled();
		expect(second.subscription.park).not.toHaveBeenCalled();
		const leases = _PublishedLeases(first, second);
		expect(leases.length).toBeGreaterThanOrEqual(2);
		expect(new Set(leases.map(lease => lease.leaseId)).size).toBe(1);
		expect(leases.every(lease => lease.leaseGeneration === 1)).toBe(true);
		expect(first.claims.claim.mock.calls.every(([command]) => command.leaseId === leases[0]!.leaseId)).toBe(true);
	});

	it("treat a slow consumer's late claim write as the replay it is once the other consumer finished", async function _StaleReplay()
	{
		const store = await _SeededStore();
		let held: Promise<void> | null = null;
		let releaseSlowAppend: () => void = function _NotYet() {};
		const slowStore: Pick<HistoryStore, "append" | "readHead" | "readStream"> = {
			readStream: store.readStream.bind(store),
			readHead: store.readHead.bind(store),
			// The slow consumer has already read revision 0 when its claim write is held until the fast one is done.
			append: async function _HeldAppend(command) { held = new Promise<void>(function _Hold(resolve) { releaseSlowAppend = resolve; }); await held; return store.append(command); },
		};
		const fast = _Consumer(store);
		const slow = _Consumer(slowStore, fast.claims);

		const slowOutcome = slow.authority.activate(_Delivery().data as never);
		await vi.waitFor(function _SlowIsHolding() { expect(held).not.toBeNull(); });
		await expect(fast.authority.activate(_Delivery().data as never)).resolves.toBe("activated");
		releaseSlowAppend();

		await expect(slowOutcome).resolves.toBe("idempotent");
		expect(store.streams.get(_STREAM)).toHaveLength(3);
		expect(new Set(_PublishedLeases(fast, slow).map(lease => lease.leaseId)).size).toBe(1);
	});

	it("let the revision fence reject a stale claim write and settle on the current state after redelivery", async function _FencedWrite()
	{
		const store = await _SeededStore();
		const retiring = new ConversationComputerHistory(store);
		const fencedStore: Pick<HistoryStore, "append" | "readHead" | "readStream"> = {
			readStream: store.readStream.bind(store),
			readHead: store.readHead.bind(store),
			// Another writer retires the computer between this consumer's pre-check and its store write.
			append: async function _RacedAppend(command)
			{
				if (store.streams.get(_STREAM)!.length === 1)
					await retiring.append({ expectedRevision: 0n, eventId: "0a1b2c3d-0000-5000-8000-000000000002", computer: { ..._COLD, state: ConversationComputerStates.Retired, updatedAt: "2026-09-05T00:00:01.000Z" }, lease: null });
				return store.append(command);
			},
		};
		const consumer = _Consumer(fencedStore);

		await _ConsumeUntilSettled(consumer);

		expect(consumer.subscription.retry).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 0 }), "conversation computer activation authority unavailable");
		expect(consumer.subscription.acknowledge).toHaveBeenCalledOnce();
		expect(store.streams.get(_STREAM)!.map(event => (event.data["computer"] as { state: string }).state)).toEqual([ConversationComputerStates.Cold, ConversationComputerStates.Retired]);
		expect(consumer.projections.publishActiveLease).not.toHaveBeenCalled();
	});
});
