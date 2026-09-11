import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance, type ConversationAsset, type ConversationAssetsGateway, type ReserveConversationAssetUpload } from "@opencrane/state/conversation/assets";

import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict, _LocalDevelopmentUnavailable } from "./local-development.failures";
import type { _LocalDevelopmentState } from "./local-development.owner.types";

/** Stable timestamp used by disposable file metadata. */
const _NOW = "2026-09-10T09:00:00.000Z";

/** Requires a current conversation before a local file command can mutate its resources. */
function _RequireConversation(state: _LocalDevelopmentState, conversationId: string): void
{
	if (!state.conversations.some(function _Conversation(item) { return item.id === conversationId; }))
	{
		_LocalDevelopmentAccessChanged();
	}
}

/** Names the conversation-scoped retry slot used by file reservations. */
function _ReceiptKey(conversationId: string, idempotencyKey: string): string
{
	return `${conversationId}\u0000${idempotencyKey}`;
}

/** Names byte storage by both owning conversation and file coordinate. */
function _ByteKey(conversationId: string, assetId: string): string
{
	return `${conversationId}\u0000${assetId}`;
}

/** Compares every immutable reservation field. */
function _SameReservation(left: ReserveConversationAssetUpload, right: ReserveConversationAssetUpload): boolean
{
	return left.displayName.trim() === right.displayName.trim() && left.mediaType === right.mediaType && left.byteLength === right.byteLength && left.contentAddress === right.contentAddress;
}

/** Reads one file only from its owning conversation. */
function _Asset(state: _LocalDevelopmentState, conversationId: string, assetId: string): ConversationAsset
{
	const asset = (state.assets.get(conversationId) ?? []).find(function _Current(item) { return item.id === assetId; });
	if (asset === undefined)
	{
		return _LocalDevelopmentUnavailable();
	}
	return asset;
}

/** Creates the complete in-memory conversation-file adapter. */
export function _CreateLocalDevelopmentAssets(state: _LocalDevelopmentState): ConversationAssetsGateway
{
	return {
		list: async function _List(conversationId: string) { return state.assets.get(conversationId) ?? []; },
		read: async function _Read(conversationId: string, assetId: string)
		{
			_Asset(state, conversationId, assetId);
			const value = state.assetBytes.get(_ByteKey(conversationId, assetId));
			if (value === undefined)
			{
				return _LocalDevelopmentUnavailable();
			}
			return value;
		},
		reserve: async function _Reserve(conversationId: string, request: ReserveConversationAssetUpload)
		{
			_RequireConversation(state, conversationId);
			const receiptKey = _ReceiptKey(conversationId, request.idempotencyKey);
			const receipt = state.assetReceipts.get(receiptKey);
			if (receipt !== undefined)
			{
				if (!_SameReservation(receipt.request, request))
				{
					return _LocalDevelopmentConflict();
				}
				return _Asset(state, conversationId, receipt.assetId);
			}
			const asset: ConversationAsset = { id: request.idempotencyKey, conversationId, messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetLifecycle.Uploading, displayName: request.displayName, mediaType: request.mediaType, byteLength: request.byteLength, disposition: null, failureCode: null, canRemove: true, createdAt: _NOW };
			state.assets.set(conversationId, [...(state.assets.get(conversationId) ?? []), asset]);
			state.assetReceipts.set(receiptKey, { conversationId, request, assetId: asset.id });
			return asset;
		},
		upload: async function _Upload(conversationId: string, assetId: string, file: File)
		{
			_RequireConversation(state, conversationId);
			const current = _Asset(state, conversationId, assetId);
			const ready = { ...current, state: ConversationAssetLifecycle.Ready, disposition: ConversationAssetDisposition.Download };
			state.assets.set(conversationId, (state.assets.get(conversationId) ?? []).map(item => item.id === assetId ? ready : item));
			state.assetBytes.set(_ByteKey(conversationId, assetId), file);
			return ready;
		},
		remove: async function _Remove(conversationId: string, assetId: string)
		{
			_RequireConversation(state, conversationId);
			const current = _Asset(state, conversationId, assetId);
			const removed = { ...current, state: ConversationAssetLifecycle.Removed, canRemove: false };
			state.assets.set(conversationId, (state.assets.get(conversationId) ?? []).map(item => item.id === assetId ? removed : item));
			state.assetBytes.delete(_ByteKey(conversationId, assetId));
			return removed;
		}
	};
}
