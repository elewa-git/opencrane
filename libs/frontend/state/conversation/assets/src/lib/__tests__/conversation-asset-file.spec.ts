import { describe, expect, it } from "vitest";

import { ___CONVERSATION_ASSET_MAX_TOTAL_BYTES } from "@opencrane/models/conversation-assets";

import { _ConversationAssetFileMediaType, _DecideConversationAssetFiles } from "../conversation-asset-file.js";

describe("conversation asset file policy", function _Suite()
{
	it("infers known types only when the browser supplied no useful type", function _Infers()
	{
		expect(_ConversationAssetFileMediaType(new File(["pdf"], "brief.PDF"))).toBe("application/pdf");
		expect(_ConversationAssetFileMediaType(new File(["db"], "renamed.zip", { type: "application/vnd.sqlite3" }))).toBe("application/vnd.sqlite3");
	});

	it("rejects the whole message selection before work starts", function _RejectsBatch()
	{
		const tooMany = Array.from({ length: 11 }, (_, index) => new File(["x"], `${index}.png`, { type: "image/png" }));
		expect(_DecideConversationAssetFiles(tooMany).failureCode).toBe("too_many_files");
		expect(_DecideConversationAssetFiles([new File(["db"], "data.sqlite", { type: "application/vnd.sqlite3" })]).failureCode).toBe("unsupported_media_type");
		const oversized = { name: "large.pdf", type: "application/pdf", size: ___CONVERSATION_ASSET_MAX_TOTAL_BYTES + 1 } as File;
		expect(_DecideConversationAssetFiles([oversized]).failureCode).toBe("total_too_large");
	});
});
