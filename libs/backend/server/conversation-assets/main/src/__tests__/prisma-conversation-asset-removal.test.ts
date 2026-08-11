import { ArtifactState, ArtifactUploadLeaseState, ConversationAssetProvenance, ConversationAssetState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationAssetRepository } from "../prisma-conversation-asset-repository.js";

const _CALLER = { siloId: "silo-1", subjectId: "user-1" } as const;

/** Complete persisted upload fixture used by browser-safe projection tests. */
function _Asset(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", messageId: null, artifactId: "artifact-1", revisionId: null, uploadLeaseId: "lease-1", idempotencyKey: "upload-1", provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Uploading, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5n, failureCode: null, createdByUserId: "user-1", createdAt: new Date("2026-08-11T10:00:00.000Z"), ...overrides };
}

/** Transaction mock with active participant and organization membership authority. */
function _Transaction(asset: Record<string, unknown>)
{
	return {
		conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ id: "participant-1" }) },
		orgMembership: { count: vi.fn().mockResolvedValue(1) },
		conversationAsset: {
			findFirst: vi.fn().mockResolvedValue(asset),
			findMany: vi.fn().mockResolvedValue([asset]),
			update: vi.fn().mockImplementation(async function _Update({ data }: { data: Record<string, unknown> }) { return { ...asset, ...data }; })
		},
		artifactUploadLease: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		artifact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
	};
}

describe("PrismaConversationAssetRepository removal", function _Suite()
{
	it("revokes and sanitizes only the caller's unlinked upload reservation", async function _RemovesReservation()
	{
		const transaction = _Transaction(_Asset());
		const result = await new PrismaConversationAssetRepository(transaction as never).remove(_CALLER, "conversation-1", "asset-1");

		expect(result).toMatchObject({ outcome: "accepted", asset: { state: "removed", displayName: "Attachment removed", mediaType: "application/octet-stream", byteLength: null, canRemove: false, canRetry: false } });
		expect(transaction.artifactUploadLease.updateMany).toHaveBeenCalledWith({ where: { id: "lease-1", state: ArtifactUploadLeaseState.Active }, data: { state: ArtifactUploadLeaseState.Cancelled } });
		expect(transaction.artifact.updateMany).toHaveBeenCalledWith({ where: { id: "artifact-1", state: ArtifactState.Active }, data: { state: ArtifactState.DeletionPending, deletedAt: expect.any(Date) } });
		expect(transaction.conversationAsset.update).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: { state: ConversationAssetState.Removed, displayName: "Attachment removed", mediaType: "application/octet-stream", byteLength: null, failureCode: null, removedAt: expect.any(Date) } });
	});

	it.each([
		["message-linked", { messageId: "message-1" }],
		["already uploaded", { revisionId: "revision-1", state: ConversationAssetState.Processing }],
		["assistant-created", { provenance: ConversationAssetProvenance.AgentOutput, createdByUserId: null }]
	])("denies removal for %s files without mutating persistence", async function _DeniesRemoval(_label, overrides)
	{
		const transaction = _Transaction(_Asset(overrides));
		expect(await new PrismaConversationAssetRepository(transaction as never).remove(_CALLER, "conversation-1", "asset-1")).toEqual({ outcome: "denied", reason: "asset_unavailable" });
		expect(transaction.artifactUploadLease.updateMany).not.toHaveBeenCalled();
		expect(transaction.artifact.updateMany).not.toHaveBeenCalled();
		expect(transaction.conversationAsset.update).not.toHaveBeenCalled();
	});

	it("returns caller-specific capabilities without exposing another participant's reservation", async function _ProjectsCapability()
	{
		const transaction = _Transaction(_Asset());
		const owner = await new PrismaConversationAssetRepository(transaction as never).list(_CALLER, "conversation-1");
		const participant = await new PrismaConversationAssetRepository(transaction as never).list({ ..._CALLER, subjectId: "user-2" }, "conversation-1");
		expect(owner[0]).toMatchObject({ canRemove: true, canRetry: false });
		expect(participant[0]).toMatchObject({ canRemove: false, canRetry: false });
	});
});
