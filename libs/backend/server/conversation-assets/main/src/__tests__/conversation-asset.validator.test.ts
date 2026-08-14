import { describe, expect, it } from "vitest";

import { _ParseReserveConversationAsset } from "../conversation-asset.validator";

const _VALID_RESERVATION = { idempotencyKey: "upload-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}` } as const;

describe("participant conversation asset reservation validator", function _Suite()
{
	it("accepts and normalizes the exact model", function _AcceptsExactModel()
	{
		expect(_ParseReserveConversationAsset({ ..._VALID_RESERVATION, displayName: " brief.pdf " })).toEqual(_VALID_RESERVATION);
	});

	it("rejects unknown fields, invalid digests, and unsupported media", function _RejectsInvalidModel()
	{
		expect(_ParseReserveConversationAsset({ ..._VALID_RESERVATION, lease: "caller-controlled" })).toBeNull();
		expect(_ParseReserveConversationAsset({ ..._VALID_RESERVATION, contentAddress: "sha256:wrong" })).toBeNull();
		expect(_ParseReserveConversationAsset({ ..._VALID_RESERVATION, mediaType: "application/vnd.sqlite3" })).toBeNull();
	});
});
