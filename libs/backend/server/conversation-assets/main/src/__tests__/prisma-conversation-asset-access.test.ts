import { ArtifactRevisionState, ArtifactState, ArtifactUploadLeaseState, ConversationAssetState, ConversationLifecycle } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationAssetDisposition } from "@opencrane/models/conversation-assets";

import { PrismaConversationAssetRepository } from "../prisma-conversation-asset-repository";
import { PrismaConversationAssetUnitOfWork } from "../prisma-conversation-asset-unit-of-work";

const _CALLER = { siloId: "silo-1", subjectId: "user-1", principalId: "principal-1" } as const;
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

	it("scopes the same retry key independently to each participant", async function _ScopesRetryCoordinate()
	{
		const createdAt = new Date("2026-08-11T10:00:00.000Z");
		const transaction = {
			..._Access(true), artifact: { create: vi.fn() }, artifactUploadLease: { create: vi.fn() },
			conversationAsset: {
				findUnique: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockImplementation(async function _Create({ data }: { readonly data: Record<string, unknown> }) { return { ...data, messageId: null, revisionId: null, failureCode: null, createdAt }; })
			}
		};
		const repository = new PrismaConversationAssetRepository(transaction as never);
		const request = { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS };

		expect((await repository.reserve(_CALLER, "conversation-1", request)).outcome).toBe("accepted");
		expect((await repository.reserve({ ..._CALLER, subjectId: "user-2" }, "conversation-1", request)).outcome).toBe("accepted");
		expect(transaction.conversationAsset.findUnique).toHaveBeenNthCalledWith(1, { where: { conversationId_createdByUserId_idempotencyKey: { conversationId: "conversation-1", createdByUserId: "user-1", idempotencyKey: "upload-1" } }, include: { uploadLease: true } });
		expect(transaction.conversationAsset.findUnique).toHaveBeenNthCalledWith(2, { where: { conversationId_createdByUserId_idempotencyKey: { conversationId: "conversation-1", createdByUserId: "user-2", idempotencyKey: "upload-1" } }, include: { uploadLease: true } });
	});

	it("rejects an idempotency retry whose content address changed", async function _RejectsChangedDigest()
	{
		const transaction = {
			..._Access(true),
			conversationAsset: { findUnique: vi.fn().mockResolvedValue({ displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5n, artifactId: "artifact-1", uploadLease: { expectedContentAddress: _ADDRESS } }) },
		};
		const changedAddress = `sha256:${"b".repeat(64)}`;

		const result = await new PrismaConversationAssetRepository(transaction as never).reserve(_CALLER, "conversation-1", { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: changedAddress });

		expect(result).toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("lists assets for a current participant without requiring an open lifecycle", async function _ReadsClosedConversation()
	{
		const transaction = { ..._Access(true), conversationAsset: { findMany: vi.fn().mockResolvedValue([]) } };

		expect(await new PrismaConversationAssetRepository(transaction as never).list(_CALLER, "conversation-1")).toEqual([]);

		expect(transaction.conversationParticipant.findFirst).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", userId: "user-1", accessEndedPosition: null, conversation: expect.objectContaining({ siloId: "silo-1" }) } });
		expect(transaction.conversationAsset.findMany).toHaveBeenCalledOnce();
	});

	it("reloads active participant authority before selecting one exact ready published revision", async function _ReadsReadyRevision()
	{
		const transaction = {
			..._Access(true),
			conversationAsset: { findFirst: vi.fn().mockResolvedValue({ id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", artifactId: "artifact-1", revisionId: "revision-1", state: ConversationAssetState.Ready, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5n, artifact: { state: ArtifactState.Active }, revision: { id: "revision-1", artifactId: "artifact-1", state: ArtifactRevisionState.Published, mediaType: "application/pdf", byteLength: 5n } }) }
		};

		await expect(new PrismaConversationAssetRepository(transaction as never).readReadyTarget(_CALLER, "conversation-1", "asset-1")).resolves.toEqual({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview });
		expect(transaction.conversationParticipant.findFirst).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", userId: "user-1", accessEndedPosition: null, conversation: expect.objectContaining({ siloId: "silo-1" }) } });
		expect(transaction.conversationAsset.findFirst).toHaveBeenCalledWith({ where: { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", state: ConversationAssetState.Ready }, include: { artifact: true, revision: true } });
	});

	it("does not resolve ready bytes after participant access ends", async function _DeniesRevokedRead()
	{
		const transaction = { ..._Access(false), conversationAsset: { findFirst: vi.fn() } };
		await expect(new PrismaConversationAssetRepository(transaction as never).readReadyTarget(_CALLER, "conversation-1", "asset-1")).resolves.toBeNull();
		expect(transaction.conversationAsset.findFirst).not.toHaveBeenCalled();
	});

	it("does not resolve child assets after immediate-parent access ends", async function _DeniesParentRevocation()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { conversationParticipant: { findFirst }, orgMembership: { count: vi.fn().mockResolvedValue(1) }, conversationAsset: { findFirst: vi.fn() } };

		await expect(new PrismaConversationAssetRepository(transaction as never).readReadyTarget(_CALLER, "child-1", "asset-1")).resolves.toBeNull();
		expect(findFirst).toHaveBeenCalledWith({ where: { conversationId: "child-1", userId: "user-1", accessEndedPosition: null, conversation: expect.objectContaining({ OR: expect.arrayContaining([{ originAgentThread: { is: { parentConversation: { participants: { some: { userId: "user-1", accessEndedPosition: null } } } } } }]) }) } });
		expect(transaction.conversationAsset.findFirst).not.toHaveBeenCalled();
	});

	it("denies a reservation when the participant conversation is closed", async function _DeniesClosedMutation()
	{
		const findFirst = vi.fn().mockImplementation(async function _Participant({ where }: { readonly where: { readonly conversation: { readonly lifecycle?: ConversationLifecycle } } }) { return where.conversation.lifecycle === ConversationLifecycle.Open ? null : { id: "participant-1" }; });
		const transaction = { conversationParticipant: { findFirst }, orgMembership: { count: vi.fn().mockResolvedValue(1) }, conversationAsset: { findUnique: vi.fn() } };

		const result = await new PrismaConversationAssetRepository(transaction as never).reserve(_CALLER, "conversation-1", { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS });

		expect(result).toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(findFirst).toHaveBeenCalledWith({ where: { conversationId: "conversation-1", userId: "user-1", accessEndedPosition: null, conversation: expect.objectContaining({ siloId: "silo-1", lifecycle: ConversationLifecycle.Open }) } });
		expect(transaction.conversationAsset.findUnique).not.toHaveBeenCalled();
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

		const result = await new PrismaConversationAssetUnitOfWork(prisma as never, service, crypto, { open: vi.fn() }).upload(_CALLER, "conversation-1", "asset-1", (async function* _Bytes() { yield new Uint8Array([1]); })());

		expect(service.promote).toHaveBeenCalledOnce();
		expect(result).toEqual({ outcome: "denied", reason: "conversation_unavailable" });
		expect(finalizeTransaction.conversationAsset.findFirst).not.toHaveBeenCalled();
		expect(finalizeTransaction.artifactRevision.create).not.toHaveBeenCalled();
	});

	it("refuses new upload work when no scanner can consume quarantine", async function _ScannerUnavailable()
	{
		const prisma = { $transaction: vi.fn() };
		const service = { promote: vi.fn() };
		const authority = new PrismaConversationAssetUnitOfWork(prisma as never, service, {} as never, { open: vi.fn() }, false);
		const request = { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: _ADDRESS };

		await expect(authority.reserveUpload(_CALLER, "conversation-1", request)).resolves.toEqual({ outcome: "denied", reason: "scanner_unavailable" });
		await expect(authority.upload(_CALLER, "conversation-1", "asset-1", (async function* _Bytes() { yield new Uint8Array([1]); })())).resolves.toEqual({ outcome: "denied", reason: "scanner_unavailable" });
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(service.promote).not.toHaveBeenCalled();
	});
});
