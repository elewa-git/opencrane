import { describe, expect, it, vi } from "vitest";

import { ComputerLeaseStates, ConversationComputerStates, type ConversationComputer } from "@opencrane/contracts";

import { ConversationComputerActivationClaimAuthority } from "../conversation-computer-activation-authority";
import type { CurrentConversationComputer } from "../conversation-computers/conversation-computer-history.types";

/** Builds one checked pending-computer snapshot for an activation delivery. */
function _PendingCurrent(overrides: Partial<CurrentConversationComputer> = {}): CurrentConversationComputer
{
	const computer: ConversationComputer = {
		schemaVersion: 1,
		id: "computer-1",
		siloId: "silo-1",
		conversationId: "conversation-1",
		agentIdentityId: "identity-1",
		profileRevisionId: "profile-1",
		state: ConversationComputerStates.ClaimPending,
		leaseGeneration: 2,
		workspaceCheckpoint: null,
		activeExecution: null,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:01:00.000Z",
	};
	return {
		streamName: "conversation-computer-computer-1",
		revision: 4n,
		computer,
		lease: {
			schemaVersion: 1,
			id: "lease-2",
			computerId: "computer-1",
			generation: 2,
			sandboxClaimId: "computer-1-g2",
			sandboxId: null,
			runtimePod: null,
			state: ComputerLeaseStates.Claimed,
			claimedAt: "2026-09-01T00:01:00.000Z",
			expiresAt: "2026-09-01T00:20:00.000Z",
			releasedAt: null,
		},
		...overrides,
	};
}

/** Builds the authority with controllable checked-history, profile, and Kubernetes results. */
function _Authority(current: CurrentConversationComputer | null, overrides: {
	readonly profile?: { readonly namespace: string; readonly sandboxProfile: string; readonly warmPoolName: string } | null;
	readonly receipt?: { readonly namespace: string; readonly claimName: string; readonly disposition: "created" | "existing" };
} = {})
{
	const dispatched = current === null ? null : {
		...current,
		computer: current.computer.state === ConversationComputerStates.ClaimPending
			? { ...current.computer, state: ConversationComputerStates.ClaimDispatched, updatedAt: "2026-09-01T00:02:00.000Z" }
			: current.computer,
	};
	const append = vi.fn().mockResolvedValue({});
	const loadForActivation = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(current).mockResolvedValue(dispatched);
	const resolve = vi.fn().mockResolvedValue(overrides.profile === undefined ? { namespace: "sandbox-system", sandboxProfile: "developer", warmPoolName: "developer-pool" } : overrides.profile);
	const ensure = vi.fn().mockResolvedValue(overrides.receipt ?? { namespace: "sandbox-system", claimName: "computer-1-g2", disposition: "created" });
	const authority = new ConversationComputerActivationClaimAuthority({
		history: { append, loadForActivation },
		profiles: { resolve },
		claims: { ensure },
		clock: { now: function _Now() { return new Date("2026-09-01T00:02:00.000Z"); } },
	});
	return { append, authority, ensure, loadForActivation, resolve };
}

describe("ConversationComputerActivationClaimAuthority", function _DescribeConversationComputerActivationClaimAuthority()
{
	it("creates the one history-bound pending lease claim", async function _CreatesHistoryBoundClaim()
	{
		const subject = _Authority(_PendingCurrent());

		await expect(subject.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toBe("activated");

		expect(subject.loadForActivation).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1" });
		expect(subject.append).toHaveBeenCalledWith(expect.objectContaining({
			expectedRevision: 4n,
			computer: expect.objectContaining({ state: ConversationComputerStates.ClaimDispatched }),
			lease: _PendingCurrent().lease,
		}));
		expect(subject.resolve).toHaveBeenCalledWith({ siloId: "silo-1", profileRevisionId: "profile-1" });
		expect(subject.ensure).toHaveBeenCalledWith(expect.objectContaining({ namespace: "sandbox-system", siloId: "silo-1", computerId: "computer-1", generation: 2, profile: "developer", warmPoolName: "developer-pool", shutdownTime: new Date("2026-09-01T00:20:00.000Z") }));
	});

	it("acknowledges missing, stale, expired, and already warm deliveries without a claim", async function _AcknowledgesNonPendingDeliveries()
	{
		const missing = _Authority(null);
		await expect(missing.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toBe("denied");
		const stale = _Authority(_PendingCurrent());
		await expect(stale.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 3 })).resolves.toBe("denied");
		const expired = _Authority(_PendingCurrent({ lease: { ..._PendingCurrent().lease!, expiresAt: "2026-09-01T00:01:00.000Z" } }));
		await expect(expired.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toBe("denied");
		const warm = _PendingCurrent({
			computer: { ..._PendingCurrent().computer, state: ConversationComputerStates.Warm },
			lease: { ..._PendingCurrent().lease!, sandboxId: "sandbox-1", runtimePod: { namespace: "sandbox-system", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-uid-1" }, state: ComputerLeaseStates.Active },
		});
		const idempotent = _Authority(warm);
		await expect(idempotent.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toBe("idempotent");

		expect(missing.ensure).not.toHaveBeenCalled();
		expect(stale.ensure).not.toHaveBeenCalled();
		expect(expired.ensure).not.toHaveBeenCalled();
		expect(idempotent.ensure).not.toHaveBeenCalled();
	});

	it("retries an already dispatched generation without appending a second dispatch fence", async function _RetriesDispatchedGeneration()
	{
		const dispatched = _PendingCurrent({ computer: { ..._PendingCurrent().computer, state: ConversationComputerStates.ClaimDispatched } });
		const subject = _Authority(dispatched);

		await expect(subject.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toBe("activated");

		expect(subject.append).not.toHaveBeenCalled();
		expect(subject.ensure).toHaveBeenCalledOnce();
	});

	it("parks an unavailable profile or claim receipt that does not match history", async function _ParksInvalidRealization()
	{
		const unavailable = _Authority(_PendingCurrent(), { profile: null });
		await expect(unavailable.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toEqual({ action: "park", reason: "computer profile is not admitted by this release" });
		const foreignReceipt = _Authority(_PendingCurrent(), { receipt: { namespace: "sandbox-system", claimName: "computer-1-g3", disposition: "existing" } });
		await expect(foreignReceipt.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toEqual({ action: "park", reason: "sandbox claim does not match the recorded computer lease" });
		const mismatchedHistory = _Authority(_PendingCurrent({ lease: { ..._PendingCurrent().lease!, sandboxClaimId: "computer-1-g3" } }));
		await expect(mismatchedHistory.authority.activate({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", generation: 2 })).resolves.toEqual({ action: "park", reason: "sandbox claim does not match the recorded computer lease" });

		expect(unavailable.ensure).not.toHaveBeenCalled();
		expect(unavailable.append).not.toHaveBeenCalled();
		expect(mismatchedHistory.ensure).not.toHaveBeenCalled();
	});
});
