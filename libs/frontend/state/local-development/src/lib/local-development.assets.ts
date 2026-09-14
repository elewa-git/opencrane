import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance, type ConversationAsset, type ConversationAssetsGateway, type ReserveConversationAssetUpload } from "@opencrane/state/conversation/assets";

import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict, _LocalDevelopmentUnavailable } from "./local-development.failures";
import { _LOCAL_DEVELOPMENT_NOW } from "./local-development.fixture-coordinates";
import type { _LocalDevelopmentState } from "./local-development.owner.types";

/** Requires a current conversation before a local file command can mutate its resources. */
function _RequireConversation(state: _LocalDevelopmentState, conversationId: string): void
{
	if (!state.conversations.some((item) => item.id === conversationId))
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
	return left.displayName.trim() === right.displayName.trim()
		&& left.mediaType === right.mediaType
		&& left.byteLength === right.byteLength
		&& left.contentAddress === right.contentAddress;
}

/** Reads one file only from its owning conversation. */
function _Asset(state: _LocalDevelopmentState, conversationId: string, assetId: string): ConversationAsset
{
	const asset = (state.assets.get(conversationId) ?? []).find((item) => item.id === assetId);
	if (!asset)
	{
		return _LocalDevelopmentUnavailable();
	}

	return asset;
}

/** Creates the complete in-memory conversation-file adapter. */
export function _CreateLocalDevelopmentAssets(state: _LocalDevelopmentState): ConversationAssetsGateway
{
	async function _List(conversationId: string)
	{
		return state.assets.get(conversationId) ?? [];
	}

	async function _Read(conversationId: string, assetId: string)
	{
		_Asset(state, conversationId, assetId);
		const value = state.assetBytes.get(_ByteKey(conversationId, assetId));
		if (!value)
		{
			return _LocalDevelopmentUnavailable();
		}

		return value;
	}

	async function _Reserve(conversationId: string, request: ReserveConversationAssetUpload)
	{
		_RequireConversation(state, conversationId);
		const receiptKey = _ReceiptKey(conversationId, request.idempotencyKey);
		const receipt = state.assetReceipts.get(receiptKey);
		if (receipt)
		{
			if (!_SameReservation(receipt.request, request))
			{
				return _LocalDevelopmentConflict();
			}

			return _Asset(state, conversationId, receipt.assetId);
		}

		const asset: ConversationAsset =
		{
			id: request.idempotencyKey,
			conversationId,
			messageId: null,
			provenance: ConversationAssetProvenance.ParticipantUpload,
			state: ConversationAssetLifecycle.Uploading,
			displayName: request.displayName,
			mediaType: request.mediaType,
			byteLength: request.byteLength,
			disposition: null,
			failureCode: null,
			canRemove: true,
			createdAt: _LOCAL_DEVELOPMENT_NOW
		};
		state.assets.set(conversationId, [...(state.assets.get(conversationId) ?? []), asset]);
		state.assetReceipts.set(receiptKey,
		{
			conversationId,
			request,
			assetId: asset.id
		});

		return asset;
	}

	async function _Upload(conversationId: string, assetId: string, file: File)
	{
		_RequireConversation(state, conversationId);
		const current = _Asset(state, conversationId, assetId);
		const ready =
		{
			...current,
			state: ConversationAssetLifecycle.Ready,
			disposition: ConversationAssetDisposition.Download
		};
		state.assets.set(conversationId, (state.assets.get(conversationId) ?? []).map((item) => item.id === assetId ? ready : item));
		state.assetBytes.set(_ByteKey(conversationId, assetId), file);

		return ready;
	}

	async function _Remove(conversationId: string, assetId: string)
	{
		_RequireConversation(state, conversationId);
		const current = _Asset(state, conversationId, assetId);
		const removed =
		{
			...current,
			state: ConversationAssetLifecycle.Removed,
			canRemove: false
		};
		state.assets.set(conversationId, (state.assets.get(conversationId) ?? []).map((item) => item.id === assetId ? removed : item));
		state.assetBytes.delete(_ByteKey(conversationId, assetId));

		return removed;
	}

	return {
		list: _List,
		read: _Read,
		reserve: _Reserve,
		upload: _Upload,
		remove: _Remove
	};
}
