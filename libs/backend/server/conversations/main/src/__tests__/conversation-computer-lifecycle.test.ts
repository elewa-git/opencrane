import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerLifecycleAuthority } from "../conversation-computer-lifecycle";

const _NOW = new Date("2026-09-05T12:20:00.000Z");
const _COMPUTER: ConversationComputer = { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 2, workspaceCheckpoint: null, createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:00:00.000Z" };
const _LEASE: ComputerLease = { schemaVersion: 1, id: "lease-2", computerId: "computer-1", generation: 2, sandboxClaimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.silo-1.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T12:00:00.000Z", expiresAt: "2026-09-05T13:00:00.000Z", releasedAt: null };

function _Harness(computer: ConversationComputer = _COMPUTER, activeAttempt = false)
{
	const append = vi.fn().mockResolvedValue({});
	const history = { load: vi.fn().mockResolvedValue({ revision: 2n, streamName: "computer-computer-1", computer, lease: _LEASE }), append };
	const checkpoint = { artifactRevisionId: "revision-checkpoint-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() };
	const checkpoints = { capture: vi.fn().mockResolvedValue(checkpoint) };
	const attempts = { hasActiveAttempt: vi.fn().mockResolvedValue(activeAttempt) };
	const claims = { release: vi.fn().mockResolvedValue("released") };
	const authority = new ConversationComputerLifecycleAuthority(history as never, checkpoints, attempts, claims, "silo-1-computers", { staleAfterMilliseconds: 300_000, retireAfterMilliseconds: 1_200_000 });
	return { authority, append, checkpoints, attempts, claims, checkpoint };
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

	it("keeps cooling without checkpointing while an attempt remains active", async function _ActiveAttempt()
	{
		const { authority, append, checkpoints, claims } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling }, true);
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("active_attempt");
		expect(append).not.toHaveBeenCalled();
		expect(checkpoints.capture).not.toHaveBeenCalled();
		expect(claims.release).not.toHaveBeenCalled();
	});

	it("checkpoints before releasing and durably cools to zero after twenty minutes", async function _CheckpointRelease()
	{
		const { authority, append, checkpoints, claims, checkpoint } = _Harness({ ..._COMPUTER, state: ConversationComputerStates.Cooling });
		await expect(authority.reconcile(_COMMAND)).resolves.toBe("retired_to_checkpoint");
		expect(checkpoints.capture).toHaveBeenCalledWith(expect.objectContaining({ id: "computer-1" }), _LEASE);
		expect(claims.release).toHaveBeenCalledWith({ namespace: "silo-1-computers", claimId: "computer-1-g2", computerId: "computer-1", leaseId: "lease-2", generation: 2 });
		expect(checkpoints.capture.mock.invocationCallOrder[0]).toBeLessThan(claims.release.mock.invocationCallOrder[0]!);
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Cold, workspaceCheckpoint: checkpoint }), lease: expect.objectContaining({ state: ComputerLeaseStates.Released, releasedAt: _NOW.toISOString() }) }));
		expect(claims.release.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]!);
	});
});
