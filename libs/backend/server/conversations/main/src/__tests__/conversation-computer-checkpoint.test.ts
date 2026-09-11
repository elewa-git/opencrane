import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerCheckpointAuthority, _CheckpointArtifactId, _CheckpointRevisionId } from "../conversation-computer-checkpoint";

const _COMPUTER: ConversationComputer = { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Cooling, leaseGeneration: 2, workspaceCheckpoint: null, createdAt: "2026-09-05T12:00:00.000Z", updatedAt: "2026-09-05T12:00:00.000Z" };
const _LEASE: ComputerLease = { schemaVersion: 1, id: "lease-2", computerId: "computer-1", generation: 2, realization: { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "computer-1-g2", sandboxId: "sandbox-2", serviceFQDN: "sandbox.svc.cluster.local" }, state: ComputerLeaseStates.Active, claimedAt: "2026-09-05T12:00:00.000Z", expiresAt: "2026-09-05T13:00:00.000Z", releasedAt: null };
const _NOW = new Date("2026-09-05T12:20:00.000Z");

function _Harness()
{
	const sandbox = { capture: vi.fn().mockResolvedValue((async function* _Bytes() { yield Buffer.from("checkpoint"); })()), restore: vi.fn().mockResolvedValue(undefined) };
	const catalogue = { ensureGeneratedArtifact: vi.fn().mockResolvedValue(undefined) };
	const uploader = { upload: vi.fn().mockResolvedValue({ outcome: "finalized", idempotent: false }) };
	const reader = { read: vi.fn().mockResolvedValue(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from("checkpoint")); controller.close(); } })) };
	const fence = { assertCurrent: vi.fn().mockResolvedValue({ computer: _COMPUTER, lease: _LEASE }) };
	const authority = new ConversationComputerCheckpointAuthority(sandbox, catalogue, uploader, reader, fence, { format: "opencrane-workspace-tar-v1", maximumBytes: 64, uploadLeaseSeconds: 300 }, function _Now() { return _NOW; });
	return { authority, sandbox, catalogue, uploader, reader, fence };
}

describe("ConversationComputerCheckpointAuthority", function _Suite()
{
	it("promotes a deterministic revision before returning checkpoint history data", async function _Capture()
	{
		const { authority, catalogue, uploader } = _Harness();
		const checkpoint = await authority.capture(_COMPUTER, _LEASE);
		expect(catalogue.ensureGeneratedArtifact).toHaveBeenCalledWith({ artifactId: _CheckpointArtifactId("computer-1"), siloId: "silo-1", ownerPrincipalId: "identity-1" });
		expect(uploader.upload).toHaveBeenCalledWith(expect.objectContaining({ artifactId: _CheckpointArtifactId("computer-1"), artifactRevisionId: _CheckpointRevisionId("computer-1", 2), revision: 2, expectedByteLength: 10 }));
		expect(checkpoint).toMatchObject({ artifactRevisionId: _CheckpointRevisionId("computer-1", 2), format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() });
	});

	it("does not return history data when artifact publication fails", async function _PublicationFailure()
	{
		const { authority, uploader } = _Harness();
		uploader.upload.mockResolvedValue({ outcome: "denied", reason: "finalization_failed" });
		await expect(authority.capture(_COMPUTER, _LEASE)).rejects.toThrow("publication failed");
	});

	it("rechecks the Pod and exact lease before streaming one immutable revision", async function _Restore()
	{
		const { authority, fence, reader, sandbox } = _Harness();
		const checkpoint = { artifactRevisionId: _CheckpointRevisionId("computer-1", 2), digest: "sha256:47320987f9a49d5b00119b960f247a956773f57543982b8bfcb6da5bb3afd9ef", format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() };
		fence.assertCurrent.mockResolvedValue({ computer: { ..._COMPUTER, workspaceCheckpoint: checkpoint }, lease: _LEASE });
		const command = { siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-2", leaseGeneration: 2 }, podUid: "pod-2" };
		await expect(authority.restore(command)).resolves.toEqual({ outcome: "restored", artifactRevisionId: checkpoint.artifactRevisionId });
		expect(fence.assertCurrent).toHaveBeenCalledWith(command);
		expect(reader.read).toHaveBeenCalledWith({ siloId: "silo-1", artifactId: _CheckpointArtifactId("computer-1"), artifactRevisionId: checkpoint.artifactRevisionId });
		expect(sandbox.restore).toHaveBeenCalledOnce();
	});

	it("fails closed when the current lease differs after TokenReview", async function _RejectStaleLease()
	{
		const { authority, fence, sandbox } = _Harness();
		const checkpoint = { artifactRevisionId: "revision-1", digest: `sha256:${"a".repeat(64)}`, format: "opencrane-workspace-tar-v1", checkpointedAt: _NOW.toISOString() };
		fence.assertCurrent.mockResolvedValue({ computer: { ..._COMPUTER, workspaceCheckpoint: checkpoint }, lease: { ..._LEASE, id: "replacement-lease" } });
		await expect(authority.restore({ siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-2", leaseGeneration: 2 }, podUid: "pod-2" })).rejects.toThrow("fence changed");
		expect(sandbox.restore).not.toHaveBeenCalled();
	});
});
