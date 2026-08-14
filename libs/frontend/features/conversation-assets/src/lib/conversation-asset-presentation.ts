import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance, ConversationAssetSelectionFailures, ConversationAssetTransferPhases, type ConversationAsset, type ConversationAssetSelectionFailure, type PendingConversationAssetUpload } from "@opencrane/state/conversation/assets";

import { ConversationAssetPresentationStates, type ConversationAssetPresentation, type ConversationAssetSelectionFeedback } from "./conversation-asset-presentation.types";

/** Map one durable server asset to finite presentation without predicting a later state. */
export function __ConversationAssetPresentation(asset: ConversationAsset): ConversationAssetPresentation
{
	const state = _DurableState(asset.state);
	return { id: asset.id, messageId: asset.messageId, provenance: asset.provenance, displayName: asset.displayName, mediaType: asset.mediaType, byteLength: asset.byteLength, disposition: asset.disposition, state, detail: _StateDetail(state), canRetry: false, canRemove: asset.canRemove, uploadProgressPercent: null };
}

/** Map one browser-local intent while omitting its retained File bytes. */
export function __PendingConversationAssetPresentation(upload: PendingConversationAssetUpload): ConversationAssetPresentation
{
	const state = _PendingState(upload.phase);
	return { id: upload.idempotencyKey, messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, displayName: upload.displayName, mediaType: upload.mediaType, byteLength: upload.byteLength, disposition: _Disposition(upload.mediaType), state, detail: _StateDetail(state), canRetry: state === ConversationAssetPresentationStates.Failed, canRemove: upload.canRemove, uploadProgressPercent: upload.uploadProgressPercent };
}

/** Map typed selection rejection to stable user-facing feedback without transport details. */
export function __ConversationAssetSelectionFeedback(failure: ConversationAssetSelectionFailure): ConversationAssetSelectionFeedback
{
	switch (failure)
	{
		case ConversationAssetSelectionFailures.TooManyFiles: return { kind: failure, message: "You can add up to 10 files to one message." };
		case ConversationAssetSelectionFailures.TotalTooLarge: return { kind: failure, message: "Files in one message can total up to 200 MB." };
		case ConversationAssetSelectionFailures.UnsupportedMediaType: return { kind: failure, message: "One or more files use an unsupported type." };
	}
	throw new Error("Unsupported conversation asset selection failure.");
}

/** Format a bounded human byte count for chips, cards, and Files rows. */
export function __ConversationAssetByteLabel(byteLength: number | null): string
{
	if (byteLength === null) return "Size unavailable";
	if (byteLength < 1024) return `${byteLength} B`;
	if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
	return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

/** Uppercase supported extension label without exposing a path. */
export function __ConversationAssetTypeLabel(displayName: string, mediaType: string): string
{
	const name = displayName.toUpperCase();
	for (const extension of ["DOCX", "XLSX", "PDF", "PNG", "MP3", "ZIP"]) if (name.endsWith(`.${extension}`)) return extension;
	if (mediaType === "audio/mpeg") return "MP3";
	return "FILE";
}

/** Exhaustive durable lifecycle projection. */
function _DurableState(state: ConversationAssetLifecycle): ConversationAssetPresentationStates
{
	switch (state)
	{
		case ConversationAssetLifecycle.Uploading: return ConversationAssetPresentationStates.Uploading;
		case ConversationAssetLifecycle.Processing: return ConversationAssetPresentationStates.Processing;
		case ConversationAssetLifecycle.Ready: return ConversationAssetPresentationStates.Ready;
		case ConversationAssetLifecycle.Failed: return ConversationAssetPresentationStates.Failed;
		case ConversationAssetLifecycle.Removed: return ConversationAssetPresentationStates.Removed;
	}
}

/** Exhaustive local transfer projection. */
function _PendingState(phase: ConversationAssetTransferPhases): ConversationAssetPresentationStates
{
	switch (phase)
	{
		case ConversationAssetTransferPhases.Selected: return ConversationAssetPresentationStates.Selected;
		case ConversationAssetTransferPhases.Hashing:
		case ConversationAssetTransferPhases.Reserving: return ConversationAssetPresentationStates.Creating;
		case ConversationAssetTransferPhases.Uploading: return ConversationAssetPresentationStates.Uploading;
		case ConversationAssetTransferPhases.Failed: return ConversationAssetPresentationStates.Failed;
	}
}

/** Supported media disposition. */
function _Disposition(mediaType: string): ConversationAssetDisposition | null
{
	if (mediaType === "application/pdf" || mediaType === "image/png" || mediaType === "audio/mpeg") return ConversationAssetDisposition.Preview;
	if (mediaType === "application/zip" || mediaType.includes("officedocument")) return ConversationAssetDisposition.Download;
	return null;
}

/** Stable plain-language explanation for every visible state. */
function _StateDetail(state: ConversationAssetPresentationStates): string
{
	switch (state)
	{
		case ConversationAssetPresentationStates.Selected: return "Ready to upload";
		case ConversationAssetPresentationStates.Creating: return "Preparing file";
		case ConversationAssetPresentationStates.Uploading: return "Uploading";
		case ConversationAssetPresentationStates.Processing: return "Checking file";
		case ConversationAssetPresentationStates.Ready: return "Ready";
		case ConversationAssetPresentationStates.Failed: return "File failed";
		case ConversationAssetPresentationStates.Inaccessible: return "Access changed";
		case ConversationAssetPresentationStates.Expired: return "Expired";
		case ConversationAssetPresentationStates.Removed: return "Removed";
		case ConversationAssetPresentationStates.Unavailable: return "File unavailable";
	}
}
