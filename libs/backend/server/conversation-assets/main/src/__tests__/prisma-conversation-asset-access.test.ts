import { ArtifactUploadLeaseState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationAssetRepository } from "../prisma-conversation-asset-repository.js";
import { PrismaConversationAssetUnitOfWork } from "../prisma-conversation-asset-unit-of-work.js";

const _CALLER = { siloId: "silo-1", subjectId: "user-1" } as const;
const _ADDRESS = `sha256:${"a".repeat(64)}`;

/** Active access delegates reused by focused authority tests. */
function _Access(active: boolean)
{
	if (active) return { conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ id: "participant-1" }) }, orgMembership: { count: vi.fn().mockResolvedValue(1) } };
	return { conversationParticipant: { findFirst: vi.fn().mockResolvedValue(null) }, orgMembership: { count: vi.fn().mockResolvedValue(0) } };
}

describe("PrismaConversationAssetRepository access continuity", function _Suite()
{
	it("checks current access before resolving a reservation idempotency coordinate", async function _ChecksAccessFirst()
	{
		const transaction = { ..._Access(false), conversationAsset: { findUnique: vi.fn() } };
		const result = await new PrismaConversationAssetRepository(transaction as never).reserve(_CALLER, "conversation-1", { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS });
		expect(result).toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(transaction.conversationAsset.findUnique).not.toHaveBeenCalled();
	});

	it("does not disclose another participant's matching retry coordinate", async function _HidesForeignCoordinate()
	{
		const transaction = { ..._Access(true), conversationAsset: { findUnique: vi.fn().mockResolvedValue({ createdByUserId: "user-2" }) } };
		const result = await new PrismaConversationAssetRepository(transaction as never).reserve(_CALLER, "conversation-1", { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS });
		expect(result).toEqual({ outcome: "denied", reason: "asset_unavailable" });
	});

	it("does not issue an upload target after participant access ends", async function _DeniesRevokedTarget()
	{
		const transaction = { ..._Access(false), conversationAsset: { findFirst: vi.fn() } };
		expect(await new PrismaConversationAssetRepository(transaction as never).readUploadTarget(_CALLER, "conversation-1", "asset-1")).toBeNull();
		expect(transaction.conversationAsset.findFirst).not.toHaveBeenCalled();
	});

	it("fails finalization when access is revoked during byte promotion", async function _DeniesRevokedFinalization()
	{
		const targetTransaction = {
			..._Access(true),
			conversationAsset: { findFirst: vi.fn().mockResolvedValue({ uploadLease: { id: "lease-1", siloId: "silo-1", artifactId: "artifact-1", state: ArtifactUploadLeaseState.Active, expiresAt: new Date(Date.now() + 60_000), expectedContentAddress: _ADDRESS, expectedByteLength: 5n, mediaType: "application/pdf" } }) }
		};
		const finalizeTransaction = { ..._Access(false), conversationAsset: { findFirst: vi.fn() }, artifactRevision: { create: vi.fn() }, artifactScanJob: { create: vi.fn() } };
		const prisma = { $transaction: vi.fn().mockImplementationOnce(async function _Target(work: (transaction: unknown) => unknown) { return work(targetTransaction); }).mockImplementationOnce(async function _Finalize(work: (transaction: unknown) => unknown) { return work(finalizeTransaction); }) };
		const service = { promote: vi.fn().mockResolvedValue({ receipt: "receipt" }) };
		const crypto = { signLease: vi.fn().mockReturnValue("lease"), verifyReceipt: vi.fn().mockReturnValue({ leaseId: "lease-1", contentAddress: _ADDRESS, byteLength: 5, mediaType: "application/pdf", issuedAtEpochSeconds: 1 }), digestReceipt: vi.fn().mockReturnValue("digest") };

		const result = await new PrismaConversationAssetUnitOfWork(prisma as never, service, crypto).upload(_CALLER, "conversation-1", "asset-1", (async function* _Bytes() { yield new Uint8Array([1]); })());

		expect(service.promote).toHaveBeenCalledOnce();
		expect(result).toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(finalizeTransaction.conversationAsset.findFirst).not.toHaveBeenCalled();
		expect(finalizeTransaction.artifactRevision.create).not.toHaveBeenCalled();
	});
});
