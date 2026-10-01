import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationAssetProvenance, ConversationAssetState } from "@prisma/client";

import { PrismaScannedPdfTextRepository } from "@opencrane/backend/server/agents/artifacts";
import { ConversationAssetDisposition } from "@opencrane/models/conversation-assets";

import { PrismaConversationAssetRepository } from "../prisma-conversation-asset-repository";
import { PrismaConversationPromptDocumentRepository } from "../pdf-input/prisma-conversation-prompt-document-repository";

const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "user-1" };
const _COMMAND = { siloId: "silo-1", conversationId: "conversation-1", historyRevision: "4", orderedMessageIds: ["message-1"], requester: _CALLER } as const;
const _REFERENCE = { messageId: "message-1", blockId: "block-1", sourceArtifactId: "source-1", sourceRevisionId: "source-revision-1", name: "report.pdf", mediaType: "application/pdf" } as const;
const _ROW = { id: "asset-1", siloId: "silo-1", conversationId: "conversation-1", messageId: "message-1", artifactId: "source-1", revisionId: "source-revision-1", provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetState.Ready, createdByUserId: "user-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 100n };
const _TARGET = { siloId: "silo-1", artifactId: "source-1", artifactRevisionId: "source-revision-1", displayName: "report.pdf", mediaType: "application/pdf", byteLength: 100, disposition: ConversationAssetDisposition.Preview } as const;
const _LINEAGE = { siloId: "silo-1", sourceArtifactId: "source-1", sourceRevisionId: "source-revision-1", sourceByteLength: 100, artifactId: "text-1", artifactRevisionId: "text-revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 20, mediaType: "text/plain" } as const;

afterEach(function _RestoreRepositories() { vi.restoreAllMocks(); });

describe("Prisma conversation prompt document repository", function _ConversationPromptDocumentRepositorySuite()
{
	it("joins one message-bound source to current access and exact converted lineage", async function _ResolveDocument()
	{
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([_ROW]) } };
		vi.spyOn(PrismaConversationAssetRepository.prototype, "readReadyTarget").mockResolvedValue(_TARGET);
		vi.spyOn(PrismaScannedPdfTextRepository.prototype, "resolve").mockResolvedValue(_LINEAGE);
		const repository = new PrismaConversationPromptDocumentRepository(transaction as never);

		await expect(repository.resolve(_COMMAND, [_REFERENCE])).resolves.toEqual([{ ..._REFERENCE, siloId: "silo-1", conversationAssetId: "asset-1", sourceByteLength: 100, artifactId: "text-1", artifactRevisionId: "text-revision-1", contentAddress: _LINEAGE.contentAddress, byteLength: 20, derivedMediaType: "text/plain" }]);
		expect(PrismaConversationAssetRepository.prototype.readReadyTarget).toHaveBeenCalledWith(_CALLER, "conversation-1", "asset-1");
		expect(PrismaScannedPdfTextRepository.prototype.resolve).toHaveBeenCalledWith("silo-1", "source-1", "source-revision-1");
	});

	it.each(["requester", "binding", "authority", "lineage"])("refuses a changed %s boundary", async function _ChangedBoundary(boundary)
	{
		const row = boundary === "requester" ? { ..._ROW, createdByUserId: "other-user" } : _ROW;
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue(boundary === "binding" ? [] : [row]) } };
		vi.spyOn(PrismaConversationAssetRepository.prototype, "readReadyTarget").mockResolvedValue(boundary === "authority" ? null : _TARGET);
		vi.spyOn(PrismaScannedPdfTextRepository.prototype, "resolve").mockResolvedValue(boundary === "lineage" ? null : _LINEAGE);
		const repository = new PrismaConversationPromptDocumentRepository(transaction as never);

		await expect(repository.resolve(_COMMAND, [_REFERENCE])).rejects.toThrow();
	});

	it("revalidation refuses a changed converted revision", async function _ChangedDerivedRevision()
	{
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([_ROW]) } };
		vi.spyOn(PrismaConversationAssetRepository.prototype, "readReadyTarget").mockResolvedValue(_TARGET);
		vi.spyOn(PrismaScannedPdfTextRepository.prototype, "resolve").mockResolvedValue({ ..._LINEAGE, artifactRevisionId: "changed-text-revision" });
		const repository = new PrismaConversationPromptDocumentRepository(transaction as never);
		const prepared = { siloId: "silo-1", conversationId: "conversation-1", historyRevision: "4", orderedMessageIds: ["message-1"], documents: [{ ..._REFERENCE, siloId: "silo-1", conversationAssetId: "asset-1", sourceByteLength: 100, artifactId: "text-1", artifactRevisionId: "text-revision-1", contentAddress: _LINEAGE.contentAddress, byteLength: 20, derivedMediaType: "text/plain", text: "prepared" }] } as const;

		await expect(repository.revalidate(_COMMAND, prepared)).rejects.toThrow("authority changed");
	});

	it("refuses two Kurrent blocks that name the same bound asset", async function _RepeatedAsset()
	{
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([_ROW]) } };
		vi.spyOn(PrismaConversationAssetRepository.prototype, "readReadyTarget").mockResolvedValue(_TARGET);
		vi.spyOn(PrismaScannedPdfTextRepository.prototype, "resolve").mockResolvedValue(_LINEAGE);
		const repository = new PrismaConversationPromptDocumentRepository(transaction as never);

		await expect(repository.resolve(_COMMAND, [_REFERENCE, { ..._REFERENCE, blockId: "block-2" }])).rejects.toThrow("repeats a message-bound asset");
	});
});
