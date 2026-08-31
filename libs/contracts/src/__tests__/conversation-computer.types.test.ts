import { describe, expect, it } from "vitest";
import { ComputerLeaseStates, ComputerReviewSurfaces, ConversationComputerStates } from "../index";
import type { ComputerLease, ComputerProfileRevision, ConversationComputer } from "../index";

describe("conversation computer contracts", function ()
{
	it("fences one live lease to one logical computer", function ()
	{
		const profile: ComputerProfileRevision = {
			schemaVersion: 1,
			id: "profile-1",
			siloId: "silo-1",
			imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			runtimeClassName: "gvisor",
			securityProfileId: "computer-restricted-v1",
			dataPlaneEndpoints: [{ kind: "agent-runtime", protocolVersion: "v1", endpoint: "https://opencrane.example.internal" }],
			workspaceCheckpointFormat: "opencrane.workspace.v1",
			resourceCeiling: { requestedCpu: "250m", requestedMemory: "512Mi", maximumCpu: "1", maximumMemory: "2Gi" },
			networkProfileId: "computer-default-deny-v1",
			reviewSurfaces: [ComputerReviewSurfaces.DesktopView],
			admittedByPrincipalId: "principal-admin-1",
			admittedAt: "2026-08-31T20:00:00.000Z",
		};
		const computer: ConversationComputer = {
			schemaVersion: 1,
			id: "computer-1",
			siloId: profile.siloId,
			conversationId: "conversation-agent-1",
			agentIdentityId: "identity-agent-1",
			profileRevisionId: profile.id,
			state: ConversationComputerStates.Warm,
			leaseGeneration: 3,
			workspaceCheckpoint: null,
			createdAt: "2026-08-31T20:00:00.000Z",
			updatedAt: "2026-08-31T20:01:00.000Z",
		};
		const lease: ComputerLease = {
			schemaVersion: 1,
			id: "lease-3",
			computerId: computer.id,
			generation: computer.leaseGeneration,
			sandboxClaimId: "claim-3",
			sandboxId: "sandbox-3",
			state: ComputerLeaseStates.Active,
			claimedAt: "2026-08-31T20:01:00.000Z",
			expiresAt: "2026-08-31T20:06:00.000Z",
			releasedAt: null,
		};

		expect(lease.generation).toBe(computer.leaseGeneration);
		expect(profile.reviewSurfaces).toContain(ComputerReviewSurfaces.DesktopView);
	});
});
