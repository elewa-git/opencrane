import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { ConversationComputerActivationAuthorityAdapter, ConversationComputerHistory } from "@opencrane/backend/server/conversations";
import { describe, expect, it, vi } from "vitest";


/** Build one release-fixed activation authority with controlled external ports. */
function _Authority()
{
	const projections = { resolve: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) };
	const claims = { claim: vi.fn().mockResolvedValue({ claimId: "computer-one-g1", outcome: "existing", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local" }) };
	const profile = { profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", profileName: "developer", warmPoolName: "developer-pool", namespace: "testv5-computers", serviceAccountName: "opencrane-conversation-computer", leaseTtlMilliseconds: 60_000, maximumTurnCostUsdMicros: 100_000 };
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, {} as never, claims as never, profile);
	return { authority, claims };
}

describe("ConversationComputerActivationAuthorityAdapter", function _Suite()
{
	it("reserves a cold generation and activates only the assigned sandbox", async function _Activates()
	{
		const { authority, claims } = _Authority();
		const computer = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
		const claimedLease = { schemaVersion: 1 as const, id: "lease-1", computerId: computer.id, generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2099-09-05T00:01:01.000Z", releasedAt: null };
		const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 0n, computer, lease: null }).mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 1n, computer: { ...computer, state: ConversationComputerStates.ClaimPending }, lease: claimedLease });
		const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 1n });

		await expect(authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 1 })).resolves.toBe("activated");

		expect(load).toHaveBeenCalledTimes(2);
		expect(append).toHaveBeenCalledTimes(2);
		expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ computerId: "computer-one", generation: 1 }));
		load.mockRestore();
		append.mockRestore();
	});

	it("returns a cooling current lease to warm without replacing its generation", async function _ReactivatesCooling()
	{
		const { authority, claims } = _Authority();
		const lease = { schemaVersion: 1 as const, id: "lease-1", computerId: "computer-one", generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2099-09-05T00:01:01.000Z", releasedAt: null };
		const computer = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: ConversationComputerStates.Cooling, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:05:00.000Z" };
		const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 2n, computer, lease });
		const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 3n });
		await expect(authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 1 })).resolves.toBe("activated");
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.Warm, leaseGeneration: 1 }), lease }));
		expect(claims.claim).not.toHaveBeenCalled();
		load.mockRestore();
		append.mockRestore();
	});

	it("uses a new event identity for every cooling cycle on the same lease", async function _ReactivatesRepeatedly()
	{
		const { authority } = _Authority();
		const lease = { schemaVersion: 1 as const, id: "lease-1", computerId: "computer-one", generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2099-09-05T00:01:01.000Z", releasedAt: null };
		const computer = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: ConversationComputerStates.Cooling, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:05:00.000Z" };
		const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 2n, computer, lease }).mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 4n, computer, lease });
		const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 3n });
		await authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 1 });
		await authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 1 });
		expect(append.mock.calls[0]![0].eventId).not.toBe(append.mock.calls[1]![0].eventId);
		load.mockRestore();
		append.mockRestore();
	});

	it("increments a released cold computer and claims a new sandbox for checkpoint recovery", async function _RecoversCold()
	{
		const { authority, claims } = _Authority();
		claims.claim.mockResolvedValue({ claimId: "computer-one-g2", outcome: "existing", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local" });
		const released = { schemaVersion: 1 as const, id: "lease-old", computerId: "computer-one", generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local", state: ComputerLeaseStates.Released, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2099-09-05T00:01:01.000Z", releasedAt: "2026-09-05T00:20:00.000Z" };
		const checkpoint = { artifactRevisionId: "revision-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: "2026-09-05T00:20:00.000Z" };
		const computer = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: checkpoint, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:20:00.000Z" };
		const claimed = { ...released, id: "lease-new", generation: 2, sandboxClaimId: "computer-one-g2", sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, releasedAt: null };
		const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 3n, computer, lease: released }).mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 4n, computer: { ...computer, state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }, lease: claimed });
		const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n });
		await expect(authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 2 })).resolves.toBe("activated");
		expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({ computer: expect.objectContaining({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }), lease: expect.objectContaining({ generation: 2 }) }));
		expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, reason: "recovery_requested" }));
		load.mockRestore();
		append.mockRestore();
	});

	it("claims the next generation when activation races durable cooling release", async function _RecoversCoolingRelease()
	{
		const { authority, claims } = _Authority();
		claims.claim.mockResolvedValue({ claimId: "computer-one-g2", outcome: "existing", sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local" });
		const released = { schemaVersion: 1 as const, id: "lease-old", computerId: "computer-one", generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local", state: ComputerLeaseStates.Released, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2099-09-05T00:01:01.000Z", releasedAt: "2026-09-05T00:20:00.000Z" };
		const computer = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: ConversationComputerStates.Cooling, leaseGeneration: 1, workspaceCheckpoint: { artifactRevisionId: "revision-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: "2026-09-05T00:20:00.000Z" }, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
		const claimed = { ...released, id: "lease-new", generation: 2, sandboxClaimId: "computer-one-g2", sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, releasedAt: null };
		const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 3n, computer, lease: released }).mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 4n, computer: { ...computer, state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }, lease: claimed });
		const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n });
		await expect(authority.activate({ siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 2 })).resolves.toBe("activated");
		expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedRevision: 3n, computer: expect.objectContaining({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }) }));
		expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, reason: "recovery_requested" }));
		load.mockRestore();
		append.mockRestore();
	});
});
