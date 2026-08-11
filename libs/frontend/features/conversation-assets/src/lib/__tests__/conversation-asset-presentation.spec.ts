import { describe, expect, it } from "vitest";

import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance, ConversationAssetTransferPhases } from "@opencrane/state/conversation/assets";

import { __ConversationAssetByteLabel, __ConversationAssetPresentation, __PendingConversationAssetPresentation } from "../conversation-asset-presentation.js";
import { ConversationAssetPresentationStates } from "../conversation-asset-presentation.types.js";

describe("conversation asset presentation", function _Suite()
{
	it.each([
		[ConversationAssetLifecycle.Uploading, ConversationAssetPresentationStates.Uploading],
		[ConversationAssetLifecycle.Processing, ConversationAssetPresentationStates.Processing],
		[ConversationAssetLifecycle.Ready, ConversationAssetPresentationStates.Ready],
		[ConversationAssetLifecycle.Failed, ConversationAssetPresentationStates.Failed],
		[ConversationAssetLifecycle.Cancelled, ConversationAssetPresentationStates.Removed],
		[ConversationAssetLifecycle.Removed, ConversationAssetPresentationStates.Removed]
	] as const)("maps durable %s without predicting a later state", function _Maps(state, expected)
	{
		const result = __ConversationAssetPresentation({ id: "asset-1", conversationId: "conversation-1", messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 1024, disposition: ConversationAssetDisposition.Preview, failureCode: null, createdAt: "2026-08-11T10:00:00.000Z" });
		expect(result.state).toBe(expected);
		expect(result.canRetry).toBe(expected === ConversationAssetPresentationStates.Failed);
	});

	it("keeps pre-admission removal and retry separate", function _MapsPending()
	{
		const pending = { idempotencyKey: "retry-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 12, phase: ConversationAssetTransferPhases.Selected, canRemove: true, failureCode: null } as const;
		const selected = __PendingConversationAssetPresentation(pending);
		const failed = __PendingConversationAssetPresentation({ ...pending, idempotencyKey: "retry-2", phase: ConversationAssetTransferPhases.Failed, canRemove: false, failureCode: "upload_failed" });
		expect(selected).toMatchObject({ state: ConversationAssetPresentationStates.Selected, canRemove: true, canRetry: false });
		expect(failed).toMatchObject({ state: ConversationAssetPresentationStates.Failed, canRemove: false, canRetry: true });
	});

	it("formats bounded file sizes", function _FormatsBytes()
	{
		expect(__ConversationAssetByteLabel(null)).toBe("Size unavailable");
		expect(__ConversationAssetByteLabel(512)).toBe("512 B");
		expect(__ConversationAssetByteLabel(1536)).toBe("1.5 KB");
		expect(__ConversationAssetByteLabel(2 * 1024 * 1024)).toBe("2.0 MB");
	});
});
