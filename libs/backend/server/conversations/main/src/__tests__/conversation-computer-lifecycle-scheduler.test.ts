import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerLifecycleDueEnumerator } from "../conversation-computer-lifecycle-runtime";
import { ConversationComputerLifecycleScheduler, _LifecycleEventId } from "../conversation-computer-lifecycle-scheduler";

const _DEADLINE = new Date("2026-09-05T12:20:00.000Z");
const _CANDIDATE = { computer: { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1" }, profileRevisionId: "profile-1", state: ConversationComputerStates.Cooling, deadline: _DEADLINE };

describe("ConversationComputerLifecycleScheduler", function _Suite()
{
	it("enumerates due nonterminal projections and derives a retry-stable event id", async function _Reconcile()
	{
		const candidates = { enumerateDue: vi.fn().mockResolvedValue({ items: [_CANDIDATE], nextCursor: null }) };
		const reconciler = { reconcile: vi.fn().mockResolvedValue("retired_to_checkpoint") };
		const scheduler = new ConversationComputerLifecycleScheduler(candidates, reconciler, 25);
		await expect(scheduler.reconcileDue(_DEADLINE)).resolves.toEqual(["retired_to_checkpoint"]);
		expect(candidates.enumerateDue).toHaveBeenCalledWith(_DEADLINE, 25, null);
		expect(reconciler.reconcile).toHaveBeenCalledWith({ ..._CANDIDATE, now: _DEADLINE, eventId: _LifecycleEventId(_CANDIDATE) });
		expect(_LifecycleEventId(_CANDIDATE)).toBe(_LifecycleEventId({ ..._CANDIDATE }));
	});

	it("advances beyond a non-due first page before reconciling a later candidate", async function _DrainsPages()
	{
		const candidates = { enumerateDue: vi.fn().mockResolvedValueOnce({ items: [], nextCursor: "conversation-050" }).mockResolvedValueOnce({ items: [_CANDIDATE], nextCursor: null }) };
		const reconciler = { reconcile: vi.fn().mockResolvedValue("lost") };
		const scheduler = new ConversationComputerLifecycleScheduler(candidates, reconciler, 50);
		await expect(scheduler.reconcileDue(_DEADLINE)).resolves.toEqual(["lost"]);
		expect(candidates.enumerateDue).toHaveBeenNthCalledWith(1, _DEADLINE, 50, null);
		expect(candidates.enumerateDue).toHaveBeenNthCalledWith(2, _DEADLINE, 50, "conversation-050");
		expect(reconciler.reconcile).toHaveBeenCalledOnce();
	});

	it("reaches a missing retained host realization after fifty current conversations", async function _FindsLaterMissingHost(): Promise<void>
	{
		const coordinates = Array.from({ length: 51 }, function _Coordinate(_value, index)
		{
			const ordinal = String(index + 1).padStart(3, "0");
			return { computer: { siloId: "silo-1", computerId: `computer-${ordinal}`, conversationId: `conversation-${ordinal}`, agentIdentityId: `identity-${ordinal}` }, profileRevisionId: "profile-1" };
		});
		const projections = { enumerate: vi.fn(function _Page(_siloId: string, cursor: string | null)
		{
			return Promise.resolve(cursor === null ? { items: coordinates.slice(0, 50), nextCursor: "conversation-050" } : { items: coordinates.slice(50), nextCursor: null });
		}), resolve: vi.fn() };
		const history = { load: vi.fn(function _Current(coordinate: (typeof coordinates)[number])
		{
			const host = coordinate.computer.conversationId === "conversation-051";
			const realization = host
				? { kind: ConversationComputerRealizationKinds.HostDevelopmentProcess, processId: "local-computer-missing", endpoint: "http://127.0.0.1:8081" }
				: { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: `claim-${coordinate.computer.computerId}`, sandboxId: `sandbox-${coordinate.computer.computerId}`, serviceFQDN: `sandbox-${coordinate.computer.computerId}.computers.svc.cluster.local` };
			return Promise.resolve({ revision: 2n, streamName: `computer-${coordinate.computer.computerId}`, computer: { schemaVersion: 1, id: coordinate.computer.computerId, ...coordinate.computer, state: ConversationComputerStates.Warm, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:19:00.000Z" }, lease: { schemaVersion: 1, id: `lease-${coordinate.computer.computerId}`, computerId: coordinate.computer.computerId, generation: 1, realization, state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T12:00:00.000Z", expiresAt: "2026-09-05T13:00:00.000Z", releasedAt: null } });
		}) };
		const realizer = { inspect: vi.fn(function _Inspect(command: { readonly computerId: string })
		{
			return Promise.resolve(command.computerId === "computer-051" ? null : { shutdownTime: "2026-09-05T13:00:00.000Z" });
		}) };
		const activity = { lastActivity: vi.fn().mockResolvedValue({ lastActivityAt: new Date("2026-09-05T12:19:00.000Z"), busy: false }) };
		const enumerator = new ConversationComputerLifecycleDueEnumerator(projections, history as never, activity, realizer, "silo-1", { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000, leaseTtlMilliseconds: 3_600_000 });
		const reconciler = { reconcile: vi.fn().mockResolvedValue("lost") };
		await expect(new ConversationComputerLifecycleScheduler(enumerator, reconciler, 50).reconcileDue(_DEADLINE)).resolves.toEqual(["lost"]);
		expect(projections.enumerate).toHaveBeenNthCalledWith(1, "silo-1", null, 50);
		expect(projections.enumerate).toHaveBeenNthCalledWith(2, "silo-1", "conversation-050", 50);
		expect(reconciler.reconcile).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ computerId: "computer-051" }) }));
	});

	it("changes the idempotency coordinate when state or deadline changes", function _ChangesCoordinate()
	{
		expect(_LifecycleEventId({ ..._CANDIDATE, state: ConversationComputerStates.Warm })).not.toBe(_LifecycleEventId(_CANDIDATE));
		expect(_LifecycleEventId({ ..._CANDIDATE, deadline: new Date(_DEADLINE.getTime() + 1) })).not.toBe(_LifecycleEventId(_CANDIDATE));
	});
});
