import { ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import type { ConversationAsset } from "./conversation-assets.types";

/** Keeps only explicitly selected, unbound participant files in the next message. */
export function _ConversationMessageAssets(assets: readonly ConversationAsset[], selectedAssetIds: ReadonlySet<string>, submittedAssetIds: ReadonlySet<string>): readonly ConversationAsset[]
{
	return assets.filter(asset => selectedAssetIds.has(asset.id) && asset.provenance === ConversationAssetProvenance.ParticipantUpload && asset.state !== ConversationAssetLifecycle.Removed && asset.messageId === null && !submittedAssetIds.has(asset.id));
}

/** Returns only Ready selected assets in deterministic command order. */
export function _ReadyConversationMessageAssetIds(assets: readonly ConversationAsset[]): readonly string[]
{
	return assets.filter(asset => asset.state === ConversationAssetLifecycle.Ready).map(asset => asset.id).sort(_CompareCodeUnits);
}

/** Orders opaque ids by UTF-16 code units so message retry identity is browser-independent. */
function _CompareCodeUnits(left: string, right: string): number
{
	if (left < right)
		return -1;
	if (left > right)
		return 1;
	return 0;
}
