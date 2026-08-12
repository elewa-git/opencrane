import { describe, expect, it, vi } from "vitest";

import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { PrismaConversationAttachmentAdmissionRepository } from "../prisma-conversation-attachment-admission.js";

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
});
