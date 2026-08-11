import { describe, expect, it } from "vitest";
import { ___CONVERSATION_ASSET_MAX_TOTAL_BYTES, ___ConversationAssetMediaDisposition, ___DecideConversationAssetBatch, ConversationAssetDisposition } from "../index.js";

describe("conversation asset policy", () =>
{
	it("allows previews only for PDF, PNG, and MP3", () =>
	{
		expect(___ConversationAssetMediaDisposition("application/pdf")).toBe(ConversationAssetDisposition.Preview);
		expect(___ConversationAssetMediaDisposition("image/png")).toBe(ConversationAssetDisposition.Preview);
		expect(___ConversationAssetMediaDisposition("audio/mpeg")).toBe(ConversationAssetDisposition.Preview);
	});

	it("allows DOCX, XLSX, and ZIP only as downloads", () =>
	{
		expect(___ConversationAssetMediaDisposition("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(ConversationAssetDisposition.Download);
		expect(___ConversationAssetMediaDisposition("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(ConversationAssetDisposition.Download);
		expect(___ConversationAssetMediaDisposition("application/zip")).toBe(ConversationAssetDisposition.Download);
	});

	it("rejects SQLite and unknown media types", () =>
	{
		expect(___DecideConversationAssetBatch([{ byteLength: 10, mediaType: "application/vnd.sqlite3" }])).toEqual({ accepted: false, failureCode: "unsupported_media_type" });
	});

	it("enforces ten files and 200 MiB across one message", () =>
	{
		const elevenFiles = Array.from({ length: 11 }, () => ({ byteLength: 1, mediaType: "image/png" }));
		expect(___DecideConversationAssetBatch(elevenFiles).failureCode).toBe("too_many_files");
		expect(___DecideConversationAssetBatch([{ byteLength: ___CONVERSATION_ASSET_MAX_TOTAL_BYTES + 1, mediaType: "image/png" }]).failureCode).toBe("total_too_large");
	});
});
