import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerLifecycleAuthority } from "../conversation-computer-lifecycle";
import { ConversationComputerLifecycleDueEnumerator } from "../conversation-computer-lifecycle-runtime";
import type { ConversationComputerActivity } from "../conversation-computer-activity.types";

const _NOW = new Date("2026-09-05T12:20:00.000Z");
const _POLICY = { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000, leaseTtlMilliseconds: 3_600_000 };
const _COMPUTER: ConversationComputer = { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 2, workspaceCheckpoint: null, createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:00:00.000Z" };
const _LEASE: ComputerLease = { schemaVersion: 1, id: "lease-2", computerId: "computer-1", generation: 2, sandboxClaimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.silo-1.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T12:00:00.000Z", expiresAt: "2026-09-05T13:00:00.000Z", releasedAt: null };
const _CLAIM_COMMAND = { namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 };

function _Harness(computer: ConversationComputer = _COMPUTER, activeAttempt = false, lease: ComputerLease = _LEASE, activity: ConversationComputerActivity | null = null)
{
	const append = vi.fn().mockResolvedValue({});
	const releasedLease = { ...lease, state: ComputerLeaseStates.Released, releasedAt: _NOW.toISOString() };
	const history = { load: vi.fn().mockResolvedValueOnce({ revision: 2n, streamName: "computer-computer-1", computer, lease }).mockResolvedValue({ revision: 3n, streamName: "computer-computer-1", computer: { ...computer, workspaceCheckpoint: { artifactRevisionId: "revision-checkpoint-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() } }, lease: releasedLease }), append };
	const checkpoint = { artifactRevisionId: "revision-checkpoint-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() };
	const checkpoints = { capture: vi.fn().mockResolvedValue(checkpoint) };
	const attempts = { clearActiveLease: vi.fn().mockResolvedValue(!activeAttempt), extendActiveLease: vi.fn().mockResolvedValue(true) };
	const claims = { inspect: vi.fn().mockResolvedValue({ claimId: "computer-1-g2", sandboxId: lease.sandboxId, serviceFQDN: lease.serviceFQDN, shutdownTime: lease.expiresAt }), renew: vi.fn().mockResolvedValue("renewed"), release: vi.fn().mockResolvedValue("released") };
	const activityReader = { lastActivity: vi.fn().mockResolvedValue(activity) };
	const authority = new ConversationComputerLifecycleAuthority(history as never, checkpoints, attempts, claims, activityReader, "silo-1-computers", _POLICY);
	return { authority, history, append, checkpoints, attempts, claims, activityReader, checkpoint };
}

const _COMMAND = { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", now: _NOW, eventId: "15078eb4-5016-41d9-b749-985eba59ef70" };

describe("ConversationComputerLifecycleAuthority", function _Suite()
{
	it("marks the warm lease cooling at the durable five-minute boundary", async function _Cooling()
	{
		const computer = { ..._COMPUTER, updatedAt: "2026-09-05T12:15:00.000Z" };
		const { authority, append, checkpoints } = _Harness(computer);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("cooling");
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Cooling, updatedAt: computer.updatedAt }) }));
		expect(checkpoints.capture).not.toHaveBeenCalled();
	});

	it("measures idleness from the last settled turn instead of the activation time", async function _IdleFromActivity()
	{
		const recent = _Harness(_COMPUTER, false, _LEASE, { lastActivityAt: new Date("2026-09-05T12:18:00.000Z"), busy: false });
		await expect(recent.authority.reconcile(_COMMAND)).resolves.toBe("current");
		expect(recent.append).not.toHaveBeenCalled();
		expect(recent.activityReader.lastActivity).toHaveBeenCalledWith({ siloId: "silo-1", computerId: "computer-1", generation: 2, leaseId: "lease-2" });

		const stale = _Harness(_COMPUTER, false, _LEASE, { lastActivityAt: new Date("2026-09-05T12:14:00.000Z"), busy: false });
		await expect(stale.authority.reconcile(_COMMAND)).resolves.toBe("cooling");
	});

	it("never cools a computer whose turn is still running", async function _Busy()
	{
		const { authority, append } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling }, false, _LEASE, { lastActivityAt: new Date("2026-09-05T11:30:00.000Z"), busy: true });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("current");
		expect(append).not.toHaveBeenCalled();
	});

	it("records an expired active lease as lost and cools the computer without a checkpoint", async function _LostAfterExpiry()
	{
		const lease = { ..._LEASE, expiresAt: "2026-09-05T12:10:00.000Z" };
		const { authority, append, attempts, claims, checkpoints } = _Harness(_COMPUTER, false, lease);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("lost");
		expect(claims.inspect).not.toHaveBeenCalled();
		expect(checkpoints.capture).not.toHaveBeenCalled();
		expect(claims.release).toHaveBeenCalledWith(_CLAIM_COMMAND);
		expect(attempts.clearActiveLease.mock.invocationCallOrder[0]).toBeLessThan(claims.release.mock.invocationCallOrder[0]!);
		expect(claims.release.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]!);
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2n, computer: expect.objectContaining({ state: ConversationComputerStates.Cold, updatedAt: _NOW.toISOString() }), lease: { ...lease, state: ComputerLeaseStates.Lost, releasedAt: _NOW.toISOString() } }));
	});

	it("records an active lease whose claim disappeared as lost", async function _LostClaim()
	{
		const { authority, append, claims } = _Harness();
		claims.inspect.mockResolvedValue(null);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("lost");
		expect(claims.release).toHaveBeenCalledWith(_CLAIM_COMMAND);
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ lease: expect.objectContaining({ state: ComputerLeaseStates.Lost }) }));
	});

	it("keeps an expired lease fenced while an approval still holds the projection", async function _LostFence()
	{
		const { authority, append, claims } = _Harness(_COMPUTER, true, { ..._LEASE, expiresAt: "2026-09-05T12:10:00.000Z" });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("active_attempt");
		expect(append).not.toHaveBeenCalled();
		expect(claims.release).not.toHaveBeenCalled();
	});

	it("leaves a pending claim to the activation authority until its lease expires", async function _PendingClaim()
	{
		const claimed = { ..._LEASE, sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed };
		const pending = _Harness({ ..._COMPUTER, state: ConversationComputerStates.ClaimPending }, false, claimed);
		pending.claims.inspect.mockResolvedValue(null);
		await expect(pending.authority.reconcile(_COMMAND)).resolves.toBe("current");
		expect(pending.append).not.toHaveBeenCalled();

		const expired = _Harness({ ..._COMPUTER, state: ConversationComputerStates.ClaimPending }, false, { ...claimed, expiresAt: "2026-09-05T12:19:00.000Z" });
		await expect(expired.authority.reconcile(_COMMAND)).resolves.toBe("lost");
		expect(expired.append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Cold }), lease: expect.objectContaining({ state: ComputerLeaseStates.Lost }) }));
	});

	it("renews an in-use lease once less than half of its lifetime remains", async function _Renews()
	{
		const lease = { ..._LEASE, expiresAt: "2026-09-05T12:40:00.000Z" };
		const { authority, append, attempts, claims } = _Harness(_COMPUTER, false, lease, { lastActivityAt: new Date("2026-09-05T12:19:00.000Z"), busy: false });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("renewed");
		expect(claims.renew).toHaveBeenCalledWith({ ..._CLAIM_COMMAND, expiresAt: "2026-09-05T13:20:00.000Z" });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2n, computer: _COMPUTER, lease: { ...lease, expiresAt: "2026-09-05T13:20:00.000Z" } }));
		expect(attempts.extendActiveLease).toHaveBeenCalledWith({ siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1", leaseId: "lease-2", leaseGeneration: 2, expiresAt: "2026-09-05T13:20:00.000Z" });
		expect(claims.renew.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]!);
		expect(append.mock.invocationCallOrder[0]).toBeLessThan(attempts.extendActiveLease.mock.invocationCallOrder[0]!);
		expect(claims.release).not.toHaveBeenCalled();
	});

	it("re-patches a claim whose shutdown time lags the recorded lease", async function _RepatchesClaim()
	{
		const { authority, claims } = _Harness();
		claims.inspect.mockResolvedValue({ claimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: _LEASE.serviceFQDN, shutdownTime: "2026-09-05T12:30:00.000Z" });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("renewed");
		expect(claims.renew).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: "2026-09-05T13:20:00.000Z" }));
	});

	it("retires an idle cooling computer instead of renewing its lease", async function _RetireBeforeRenew()
	{
		const { authority, claims, checkpoints } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling }, false, { ..._LEASE, expiresAt: "2026-09-05T12:40:00.000Z" });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("retired_to_checkpoint");
		expect(claims.renew).not.toHaveBeenCalled();
		expect(checkpoints.capture).toHaveBeenCalledOnce();
	});

	it("keeps cooling after capture when an attempt wins the release fence", async function _ActiveAttempt()
	{
		const { authority, append, checkpoints, claims } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling }, true);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("active_attempt");
		expect(append).not.toHaveBeenCalled();
		expect(checkpoints.capture).toHaveBeenCalledOnce();
		expect(claims.release).not.toHaveBeenCalled();
	});

	it("checkpoints before releasing and durably cools to zero after twenty minutes", async function _CheckpointRelease()
	{
		const { authority, append, checkpoints, attempts, claims, checkpoint } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("retired_to_checkpoint");
		expect(checkpoints.capture).toHaveBeenCalledWith(expect.objectContaining({ id: "computer-1" }), _LEASE);
		expect(claims.release).toHaveBeenCalledWith(_CLAIM_COMMAND);
		expect(checkpoints.capture.mock.invocationCallOrder[0]).toBeLessThan(claims.release.mock.invocationCallOrder[0]!);
		expect(attempts.clearActiveLease).toHaveBeenCalledOnce();
		expect(attempts.clearActiveLease.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]!);
		expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Cooling, workspaceCheckpoint: checkpoint }), lease: expect.objectContaining({ state: ComputerLeaseStates.Released, releasedAt: _NOW.toISOString() }) }));
		expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Cold, workspaceCheckpoint: checkpoint }), lease: expect.objectContaining({ state: ComputerLeaseStates.Released }) }));
		expect(append.mock.invocationCallOrder[0]).toBeLessThan(claims.release.mock.invocationCallOrder[0]!);
		expect(claims.release.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[1]!);
	});

	it("finishes claim deletion after a durable released event without recapturing", async function _ResumeRelease()
	{
		const releasedLease = { ..._LEASE, state: ComputerLeaseStates.Released, releasedAt: _NOW.toISOString() };
		const computer = { ..._COMPUTER, state: ConversationComputerStates.Cooling, workspaceCheckpoint: { artifactRevisionId: "revision-checkpoint-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() } };
		const { authority, append, checkpoints, attempts, claims } = _Harness(computer, false, releasedLease);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("retired_to_checkpoint");
		expect(checkpoints.capture).not.toHaveBeenCalled();
		expect(claims.release).toHaveBeenCalledOnce();
		expect(attempts.clearActiveLease.mock.invocationCallOrder[0]).toBeLessThan(claims.release.mock.invocationCallOrder[0]!);
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ eventId: expect.not.stringMatching(_COMMAND.eventId), computer: expect.objectContaining({ state: ConversationComputerStates.Cold }), lease: releasedLease }));
	});

	it("stops release when a replacement lease won the projection fence", async function _ProjectionRace()
	{
		const { authority, append, attempts, claims } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling });
		attempts.clearActiveLease.mockResolvedValue(false);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("active_attempt");
		expect(append).not.toHaveBeenCalled();
		expect(claims.release).not.toHaveBeenCalled();
	});
});

describe("ConversationComputerLifecycleDueEnumerator", function _EnumeratorSuite()
{
	const coordinate = { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1" };

	function _Enumerator(computer: ConversationComputer, lease: ComputerLease, activity: ConversationComputerActivity | null, claim: unknown = { claimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: lease.serviceFQDN, shutdownTime: lease.expiresAt })
	{
		const projections = { enumerate: vi.fn().mockResolvedValue([coordinate]), resolve: vi.fn() };
		const history = { load: vi.fn().mockResolvedValue({ revision: 2n, streamName: "computer-computer-1", computer, lease }) };
		const claims = { inspect: vi.fn().mockResolvedValue(claim) };
		const activityReader = { lastActivity: vi.fn().mockResolvedValue(activity) };
		return new ConversationComputerLifecycleDueEnumerator(projections, history as never, activityReader, claims, "silo-1", "silo-1-computers", _POLICY);
	}

	it("does not enumerate a warm computer whose last turn settled recently", async function _RecentActivity()
	{
		const enumerator = _Enumerator(_COMPUTER, _LEASE, { lastActivityAt: new Date("2026-09-05T12:18:00.000Z"), busy: false });
		await expect(enumerator.enumerateDue(_NOW, 10)).resolves.toEqual([]);
	});

	it("enumerates a warm computer whose last turn settled before the stale boundary", async function _StaleActivity()
	{
		const enumerator = _Enumerator(_COMPUTER, _LEASE, { lastActivityAt: new Date("2026-09-05T12:14:00.000Z"), busy: false });
		await expect(enumerator.enumerateDue(_NOW, 10)).resolves.toEqual([{ ...coordinate, state: ConversationComputerStates.Warm, deadline: new Date("2026-09-05T12:19:00.000Z") }]);
	});

	it("enumerates a busy computer only when its lease needs renewal or is gone", async function _BusyRenewal()
	{
		const busy = { lastActivityAt: new Date("2026-09-05T11:00:00.000Z"), busy: true };
		await expect(_Enumerator(_COMPUTER, _LEASE, busy).enumerateDue(_NOW, 10)).resolves.toEqual([]);
		await expect(_Enumerator(_COMPUTER, { ..._LEASE, expiresAt: "2026-09-05T12:40:00.000Z" }, busy).enumerateDue(_NOW, 10)).resolves.toEqual([expect.objectContaining({ deadline: _NOW })]);
		await expect(_Enumerator(_COMPUTER, _LEASE, busy, null).enumerateDue(_NOW, 10)).resolves.toEqual([expect.objectContaining({ deadline: _NOW })]);
		await expect(_Enumerator(_COMPUTER, { ..._LEASE, expiresAt: "2026-09-05T12:10:00.000Z" }, busy).enumerateDue(_NOW, 10)).resolves.toEqual([expect.objectContaining({ deadline: new Date("2026-09-05T12:10:00.000Z") })]);
	});
});
