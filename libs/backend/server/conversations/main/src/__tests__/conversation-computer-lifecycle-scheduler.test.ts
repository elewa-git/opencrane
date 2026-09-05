import { ConversationComputerStates } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerLifecycleScheduler, _LifecycleEventId } from "../conversation-computer-lifecycle-scheduler";

const _DEADLINE = new Date("2026-09-05T12:20:00.000Z");
const _CANDIDATE = { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Cooling, deadline: _DEADLINE };

describe("ConversationComputerLifecycleScheduler", function _Suite()
{
	it("enumerates due nonterminal projections and derives a retry-stable event id", async function _Reconcile()
	{
		const candidates = { enumerateDue: vi.fn().mockResolvedValue([_CANDIDATE]) };
		const reconciler = { reconcile: vi.fn().mockResolvedValue("retired_to_checkpoint") };
		const scheduler = new ConversationComputerLifecycleScheduler(candidates, reconciler, 25);
		await expect(scheduler.reconcileDue(_DEADLINE)).resolves.toEqual(["retired_to_checkpoint"]);
		expect(candidates.enumerateDue).toHaveBeenCalledWith(_DEADLINE, 25);
		expect(reconciler.reconcile).toHaveBeenCalledWith({ ..._CANDIDATE, now: _DEADLINE, eventId: _LifecycleEventId(_CANDIDATE) });
		expect(_LifecycleEventId(_CANDIDATE)).toBe(_LifecycleEventId({ ..._CANDIDATE }));
	});

	it("changes the idempotency coordinate when state or deadline changes", function _ChangesCoordinate()
	{
		expect(_LifecycleEventId({ ..._CANDIDATE, state: ConversationComputerStates.Warm })).not.toBe(_LifecycleEventId(_CANDIDATE));
		expect(_LifecycleEventId({ ..._CANDIDATE, deadline: new Date(_DEADLINE.getTime() + 1) })).not.toBe(_LifecycleEventId(_CANDIDATE));
	});
});
