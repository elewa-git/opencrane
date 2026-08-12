import { ConversationAssetState, ConversationLifecycle, ConversationTimelineEntryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationAssetScanLifecycleReporter } from "../prisma-conversation-asset-scan-lifecycle-reporter.js";

/** Build one processing asset transaction with an open conversation. */
function _Transaction(lifecycle: ConversationLifecycle = ConversationLifecycle.Open)
{
	return {
		conversationAsset: { findFirst: vi.fn().mockResolvedValue({ id: "asset-1", conversationId: "conversation-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		conversation: { findUnique: vi.fn().mockResolvedValue({ lifecycle }) },
		conversationTimelineEntry: { create: vi.fn() },
	};
}

describe("PrismaConversationAssetScanLifecycleReporter", function _Suite()
{
	it("moves processing output to ready and appends one payload-free invalidation", async function _Ready()
	{
		const transaction = _Transaction();
		await new PrismaConversationAssetScanLifecycleReporter().reportInTransaction(transaction as never, { revisionId: "revision-1", state: "ready", failureCode: null });
		expect(transaction.conversationAsset.updateMany).toHaveBeenCalledWith({ where: { id: "asset-1", revisionId: "revision-1", state: ConversationAssetState.Processing }, data: { state: ConversationAssetState.Ready, failureCode: null } });
		expect(transaction.conversationTimelineEntry.create).toHaveBeenCalledWith({ data: { conversationId: "conversation-1", kind: ConversationTimelineEntryKind.System, systemEventId: "conversation-asset:asset-1:ready", payload: { eventType: "conversation.assets.changed" } } });
	});

	it("commits a terminal asset after closure without appending a new visible position", async function _Closed()
	{
		const transaction = _Transaction(ConversationLifecycle.Closed);
		await new PrismaConversationAssetScanLifecycleReporter().reportInTransaction(transaction as never, { revisionId: "revision-1", state: "failed", failureCode: "unsafe_file" });
		expect(transaction.conversationAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { state: ConversationAssetState.Failed, failureCode: "unsafe_file" } }));
		expect(transaction.conversationTimelineEntry.create).not.toHaveBeenCalled();
	});

	it("does not duplicate a transition already won by another scanner result", async function _Idempotent()
	{
		const transaction = _Transaction();
		transaction.conversationAsset.updateMany.mockResolvedValue({ count: 0 });
		await new PrismaConversationAssetScanLifecycleReporter().reportInTransaction(transaction as never, { revisionId: "revision-1", state: "ready", failureCode: null });
		expect(transaction.conversationTimelineEntry.create).not.toHaveBeenCalled();
	});
});
