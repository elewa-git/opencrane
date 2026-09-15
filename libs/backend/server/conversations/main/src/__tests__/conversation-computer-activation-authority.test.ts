import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationComputerActivationAuthorityAdapter } from "../conversation-computer-activation-authority";
import { ConversationComputerHistory } from "../conversation-computers";

const _PROFILE_REVISION = `sha256:${"a".repeat(64)}`;
const _PROFILE = { profileRevisionId: _PROFILE_REVISION, leaseTtlMilliseconds: 3_600_000 };
const _COMPUTER = { schemaVersion: 1 as const, id: "computer-one", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: { artifactRevisionId: "revision-1", digest: `sha256:${"b".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: "2026-09-05T00:20:00.000Z" }, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:20:00.000Z" };
const _LOST = {
	schemaVersion: 1 as const,
	id: "lease-old",
	computerId: "computer-one",
	generation: 1,
	realization: {
		kind: ConversationComputerRealizationKinds.AgentSandbox,
		claimId: "computer-one-g1",
		sandboxId: "sandbox-1",
		serviceFQDN: "sandbox-1.testv5-computers.svc.cluster.local",
	} as const,
	state: ComputerLeaseStates.Lost,
	claimedAt: "2026-09-05T00:00:01.000Z",
	expiresAt: "2026-09-05T01:00:01.000Z",
	releasedAt: "2026-09-05T01:00:30.000Z",
};
const _COMMAND = { siloId: "silo-1", computerId: "computer-one", conversationId: "conversation-1", generation: 2 };

/** Build one release-fixed activation authority with controlled external ports and spied history. */
function _Authority(assignment: { readonly sandboxId: string | null; readonly serviceFQDN: string | null })
{
	const projections = { resolve: vi.fn().mockResolvedValue({ agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION }), publishActiveLease: vi.fn().mockResolvedValue(undefined) };
	const assigned = {
		kind: ConversationComputerRealizationKinds.AgentSandbox,
		claimId: "computer-one-g2",
		...assignment,
	} as const;
	const realizer = {
		prepare: vi.fn().mockReturnValue({
			...assigned,
			sandboxId: null,
			serviceFQDN: null,
		}),
		claim: vi.fn().mockResolvedValue(assigned),
		inspect: vi.fn(),
		renew: vi.fn(),
		release: vi.fn(),
		bind: vi.fn(),
	};
	const claimed = {
		..._LOST,
		id: "lease-new",
		generation: 2,
		realization: {
			kind: ConversationComputerRealizationKinds.AgentSandbox,
			claimId: "computer-one-g2",
			sandboxId: null,
			serviceFQDN: null,
		} as const,
		state: ComputerLeaseStates.Claimed,
		releasedAt: null,
	};
	const load = vi.spyOn(ConversationComputerHistory.prototype, "load").mockResolvedValueOnce({ streamName: "conversation-computer-computer-one", revision: 3n, computer: _COMPUTER, lease: _LOST }).mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n, computer: { ..._COMPUTER, state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }, lease: claimed });
	const append = vi.spyOn(ConversationComputerHistory.prototype, "append").mockResolvedValue({ streamName: "conversation-computer-computer-one", revision: 4n });
	const authority = new ConversationComputerActivationAuthorityAdapter(projections, {} as never, realizer, _PROFILE);
	return { authority, realizer, projections, load, append, claimed, restore: function _Restore() { load.mockRestore(); append.mockRestore(); } };
}

describe("ConversationComputerActivationAuthorityAdapter", function _Suite()
{
	beforeEach(function _SetClock(): void
	{
		vi.useFakeTimers();
		vi.setSystemTime("2026-09-05T00:30:00.000Z");
	});

	afterEach(function _RestoreClock(): void
	{
		vi.useRealTimers();
	});

	it("opens generation + 1 from a lost lease exactly as it does from a released one", async function _RecoversFromLost()
	{
		const { authority, realizer, projections, append, claimed, restore } = _Authority({ sandboxId: "sandbox-2", serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local" });
		try
		{
			await expect(authority.activate(_COMMAND)).resolves.toBe("activated");
			expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedRevision: 3n, computer: expect.objectContaining({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 2 }), lease: expect.objectContaining({ generation: 2, state: ComputerLeaseStates.Claimed }) }));
			expect(realizer.claim).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, reason: "recovery_requested" }));
			expect(append).toHaveBeenNthCalledWith(2, expect.objectContaining({
				expectedRevision: 4n,
				computer: expect.objectContaining({ state: ConversationComputerStates.Warm }),
				lease: expect.objectContaining({
					generation: 2,
					state: ComputerLeaseStates.Active,
					realization: expect.objectContaining({ sandboxId: "sandbox-2" }),
				}),
			}));
			expect(projections.publishActiveLease).toHaveBeenCalledWith({
				computer: {
					siloId: "silo-1",
					conversationId: "conversation-1",
					computerId: "computer-one",
					agentIdentityId: "identity-1",
				},
				lease: {
					leaseId: "lease-new",
					leaseGeneration: 2,
					realization: {
						kind: ConversationComputerRealizationKinds.AgentSandbox,
						claimId: "computer-one-g2",
						sandboxId: "sandbox-2",
						serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local",
					},
					expiresAt: claimed.expiresAt,
				},
			});
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

	it("leaves an already-expired pending generation to lifecycle recovery without claiming it", async function _ExpiredBeforeClaim()
	{
		const { authority, realizer, projections, append, claimed, load, restore } = _Authority({
			sandboxId: "sandbox-2",
			serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local",
		});
		load.mockReset().mockResolvedValue({
			streamName: "conversation-computer-computer-one",
			revision: 4n,
			computer: {
				..._COMPUTER,
				state: ConversationComputerStates.ClaimPending,
				leaseGeneration: 2,
			},
			lease: {
				...claimed,
				expiresAt: "2026-09-05T00:29:59.999Z",
			},
		});

		try
		{
			await expect(authority.activate(_COMMAND)).resolves.toEqual({
				action: "retry",
				reason: "conversation computer claim lease expired before activation completed",
			});
			expect(realizer.claim).not.toHaveBeenCalled();
			expect(append).not.toHaveBeenCalled();
			expect(projections.publishActiveLease).not.toHaveBeenCalled();
		}
		finally
		{
			restore();
		}
	});

	it("does not activate a generation that expires while its realization becomes ready", async function _ExpiresWhileClaiming()
	{
		const { authority, realizer, projections, append, claimed, load, restore } = _Authority({
			sandboxId: "sandbox-2",
			serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local",
		});
		const assigned = {
			kind: ConversationComputerRealizationKinds.AgentSandbox,
			claimId: "computer-one-g2",
			sandboxId: "sandbox-2",
			serviceFQDN: "sandbox-2.testv5-computers.svc.cluster.local",
		} as const;
		let finishClaim!: (realization: typeof assigned) => void;
		const waitingClaim = new Promise<typeof assigned>(function _WaitForReadiness(resolve): void
		{
			finishClaim = resolve;
		});
		realizer.claim.mockReturnValue(waitingClaim);
		load.mockReset().mockResolvedValue({
			streamName: "conversation-computer-computer-one",
			revision: 4n,
			computer: {
				..._COMPUTER,
				state: ConversationComputerStates.ClaimPending,
				leaseGeneration: 2,
			},
			lease: {
				...claimed,
				expiresAt: "2026-09-05T00:30:01.000Z",
			},
		});

		try
		{
			const activation = authority.activate(_COMMAND);
			await vi.waitFor(function _ClaimStarted(): void
			{
				expect(realizer.claim).toHaveBeenCalledOnce();
			});
			vi.setSystemTime("2026-09-05T00:30:01.000Z");
			finishClaim(assigned);

			await expect(activation).resolves.toEqual({
				action: "retry",
				reason: "conversation computer claim lease expired before activation completed",
			});
			expect(append).not.toHaveBeenCalled();
			expect(projections.publishActiveLease).not.toHaveBeenCalled();
		}
		finally
		{
			restore();
		}
	});
});
