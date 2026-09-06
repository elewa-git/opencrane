import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerActivationAuthorityAdapter } from "../conversation-computer-activation-authority";
import { ConversationComputerHistory } from "../conversation-computers";

const _PROFILE_REVISION = `sha256:${"a".repeat(64)}`;
const _PROFILE = { profileRevisionId: _PROFILE_REVISION, profileName: "developer", warmPoolName: "developer-pool", namespace: "testv5-computers", leaseTtlMilliseconds: 3_600_000 };
const _COMPUTER = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: { artifactRevisionId: "revision-1", digest: `sha256:${"b".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: "2026-09-05T00:20:00.000Z" }, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:20:00.000Z" };
const _LOST = { schemaVersion: 1 as const, id: "lease-old", computerId: "computer-one", generation: 1, sandboxClaimId: "computer-one-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local", state: ComputerLeaseStates.Lost, claimedAt: "2026-09-05T00:00:01.000Z", expiresAt: "2026-09-05T01:00:01.000Z", releasedAt: "2026-09-05T01:00:30.000Z" };
const _COMMAND = { siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 2 };

/** Build one release-fixed activation authority with controlled external ports and spied history. */
function _Authority(claim: { readonly sandboxId: string | null; readonly serviceFQDN: string | null })
{
	const projections = { resolve: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION }), publishActiveLease: vi.fn().mockResolvedValue(undefined) };
	const claims = { claim: vi.fn().mockResolvedValue({ claimId: "computer-one-g2", outcome: "existing", ...claim }) };
	const claimed = { ..._LOST, id: "lease-new", generation: 2, sandboxClaimId: "computer-one-g2", sandboxId: null, serviceFQDN: null, state: ComputerLeaseStates.Claimed, releasedAt: null };
	const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 3n, computer: _COMPUTER, lease: _LOST }).mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n, computer: { ..._COMPUTER, state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }, lease: claimed });
	const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n });
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, {} as never, claims, _PROFILE);
	return { authority, claims, projections, load, append, claimed, restore: function _Restore() { load.mockRestore(); append.mockRestore(); } };
}

describe("ConversationComputerActivationAuthorityAdapter", function _Suite()
{
	it("opens generation + 1 from a lost lease exactly as it does from a released one", async function _RecoversFromLost()
	{
		const { authority, claims, projections, append, claimed, restore } = _Authority({ sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local" });
		try
		{
			await expect(authority.activate(_COMMAND)).resolves.toBe("activated");
			expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedRevision: 3n, computer: expect.objectContaining({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }), lease: expect.objectContaining({ generation: 2, state: ComputerLeaseStates.Claimed }) }));
			expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, reason: "recovery_requested" }));
			expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedRevision: 4n, computer: expect.objectContaining({ state: ConversationComputerStates.Warm }), lease: expect.objectContaining({ generation: 2, state: ComputerLeaseStates.Active, sandboxId: "sandbox-2" }) }));
			expect(projections.publishActiveLease).toHaveBeenCalledWith({ computer: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-one", agentIdentityId: "identity-1" }, lease: { leaseId: "lease-new", leaseGeneration: 2, expiresAt: claimed.expiresAt } });
		}
		finally
		{
			restore();
		}
	});

	it("reports a pending outcome instead of failing while Agent Sandbox is still assigning", async function _Pending()
	{
		const { authority, projections, append, restore } = _Authority({ sandboxId: null, serviceFQDN: null });
		try
		{
			await expect(authority.activate(_COMMAND)).resolves.toEqual({ action: "retry", reason: "Agent Sandbox has not assigned the conversation computer yet" });
			expect(append).toHaveBeenCalledOnce();
			expect(projections.publishActiveLease).not.toHaveBeenCalled();
		}
		finally
		{
			restore();
		}
	});
});
