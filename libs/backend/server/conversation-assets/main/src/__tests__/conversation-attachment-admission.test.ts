import { describe, expect, it, vi } from "vitest";

import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { PrismaConversationAttachmentAdmissionRepository } from "../prisma-conversation-attachment-admission";

describe("conversation attachment admission", () =>
{
	it("binds every ready caller-owned asset to the new message", async () =>
	{
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([{ id: "asset", mediaType: "image/png", byteLength: 10n }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
		await new PrismaConversationAttachmentAdmissionRepository(transaction as never).bindReadyAssets({ siloId: "silo", subjectId: "user" }, "conversation", "message", [{ id: "block", kind: MessageContentBlockKinds.Artifact, value: "asset" }]);
		expect(transaction.conversationAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { messageId: "message" } }));
	});

	it("rejects a partial authority match", async () =>
	{
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() } };
		await expect(new PrismaConversationAttachmentAdmissionRepository(transaction as never).bindReadyAssets({ siloId: "silo", subjectId: "user" }, "conversation", "message", [{ id: "block", kind: MessageContentBlockKinds.Artifact, value: "foreign" }])).rejects.toThrow("authority unavailable");
	});

	it("mirrors child attachment authority while reusing the immutable artifact revision", async () =>
	{
		const create = vi.fn().mockResolvedValue({});
		const transaction = { conversationAsset: { findMany: vi.fn().mockResolvedValue([{ id: "parent-asset", artifactId: "artifact-1", revisionId: "revision-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 10n }]), create } };
		const parentBlocks = [{ id: "block", kind: MessageContentBlockKinds.Artifact, value: "parent-asset" }] as const;
		const childBlocks = [{ id: "block", kind: MessageContentBlockKinds.Artifact, value: "child-asset" }] as const;
		await new PrismaConversationAttachmentAdmissionRepository(transaction as never).mirrorReadyAssets({ siloId: "silo", subjectId: "user" }, "parent", "child", "child-message", parentBlocks, childBlocks);
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "child-asset", conversationId: "child", messageId: "child-message", artifactId: "artifact-1", revisionId: "revision-1" }) });
	});
});
