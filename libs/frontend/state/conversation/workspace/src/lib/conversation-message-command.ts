import { ConversationModes } from "@opencrane/models/conversations";

import type { SubmitConversationMessageCommand } from "./conversation-workspace.types";

/** Canonicalizes one bounded unique asset set before it becomes part of message retry identity. */
export function _CanonicalConversationMessageAssetIds(assetIds: readonly string[]): readonly string[] | null
{
	if (assetIds.length > 10 || assetIds.some(assetId => assetId.trim().length === 0) || new Set(assetIds).size !== assetIds.length)
		return null;
	return [...assetIds].sort(_CompareCodeUnits);
}

/** Reuses the exact uncertain command or freezes a fresh command from the current composer. */
export function _ConversationMessageCommand(pending: SubmitConversationMessageCommand | null, conversationId: string, text: string, mode: ConversationModes, assetIds: readonly string[]): SubmitConversationMessageCommand
{
	const activation = mode === ConversationModes.AgentSession ? "start" : "none";
	if (pending !== null && pending.conversationId === conversationId && pending.activation === activation)
		return pending;
	return { conversationId, idempotencyKey: globalThis.crypto.randomUUID(), text, assetIds, activation };
}

/** Keeps the attachment set of an uncertain command visible and retryable until it converges. */
export function _ConversationMessageAssetIdsForSend(pending: SubmitConversationMessageCommand | null, currentAssetIds: readonly string[]): readonly string[]
{
	return pending?.assetIds ?? currentAssetIds;
}

/** Orders opaque ids by UTF-16 code units so retry identity does not depend on locale. */
function _CompareCodeUnits(left: string, right: string): number
{
	if (left < right)
		return -1;
	if (left > right)
		return 1;
	return 0;
}
