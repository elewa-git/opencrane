import { ConversationAssetState, ConversationLifecycle, ConversationTimelineEntryKind, type Prisma } from "@prisma/client";

import type { ConversationAssetScanLifecycleReporter } from "@opencrane/backend/server/agents/artifacts";
import { ConversationSystemEventTypes } from "@opencrane/models/conversations";

/** Conversation-owned adapter for scanner terminal transitions and safe live invalidation. */
export class PrismaConversationAssetScanLifecycleReporter implements ConversationAssetScanLifecycleReporter
{
	/** Move one processing asset exactly once, then append a payload-free list invalidation. */
	async reportInTransaction(transaction: Prisma.TransactionClient, command: { readonly revisionId: string; readonly state: "ready" | "failed"; readonly failureCode: "unsafe_file" | "scan_failed" | null }): Promise<void>
	{
		const asset = await transaction.conversationAsset.findFirst({ where: { revisionId: command.revisionId, state: ConversationAssetState.Processing }, select: { id: true, conversationId: true } });
		if (asset === null) return;
		const state = command.state === "ready" ? ConversationAssetState.Ready : ConversationAssetState.Failed;
		const changed = await transaction.conversationAsset.updateMany({ where: { id: asset.id, revisionId: command.revisionId, state: ConversationAssetState.Processing }, data: { state, failureCode: command.failureCode } });
		if (changed.count === 1) await _AppendConversationAssetsChanged(transaction, asset.conversationId, asset.id, command.state);
	}
}

/** Append one stable list invalidation only while the conversation remains open. */
export async function _AppendConversationAssetsChanged(transaction: Prisma.TransactionClient, conversationId: string, assetId: string, phase: "processing" | "ready" | "failed"): Promise<void>
{
	const conversation = await transaction.conversation.findUnique({ where: { id: conversationId }, select: { lifecycle: true } });
	if (conversation?.lifecycle !== ConversationLifecycle.Open) return;
	await transaction.conversationTimelineEntry.create({ data: { conversationId, kind: ConversationTimelineEntryKind.System, systemEventId: `conversation-asset:${assetId}:${phase}`, payload: { eventType: ConversationSystemEventTypes.AssetsChanged } } });
}
