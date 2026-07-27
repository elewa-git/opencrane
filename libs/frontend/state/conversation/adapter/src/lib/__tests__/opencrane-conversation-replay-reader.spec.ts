import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCraneConversationReplayReader, __ReadConversationReplay } from "../opencrane-conversation-replay-reader.js";

/** Construct one reader with a controlled generated-client response. */
function _Reader(body: string)
{
	const get = vi.fn().mockResolvedValue({ data: body });
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client: { GET: get } } }] });
	const reader = runInInjectionContext(injector, function _create(): OpenCraneConversationReplayReader
	{
		return new OpenCraneConversationReplayReader();
	});
	return { reader, get };
}

describe("OpenCraneConversationReplayReader", function _Suite()
{
	it("reads the owner-bound replay endpoint and resumes with the exact opaque cursor", async function _ReadsReplay()
	{
		const fixture = "id: cursor-1\nevent: ag-ui\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"thread-1\",\"runId\":\"run-1\"}\n\nid: cursor-2\nevent: ag-ui\ndata: {\"type\":\"TEXT_MESSAGE_START\",\"messageId\":\"message-1\",\"role\":\"assistant\"}\n\nid: cursor-3\nevent: ag-ui\ndata: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"messageId\":\"message-1\",\"delta\":\"hello\"}\n\n";
		const { reader, get } = _Reader(fixture);

		const state = await reader.replay("thread-1", "prior-cursor");

		expect(get).toHaveBeenCalledWith("/me/conversations/{threadId}/events", {
			params: { path: { threadId: "thread-1" }, query: { cursor: "prior-cursor" }, header: { "Last-Event-ID": "prior-cursor" } },
			parseAs: "text"
		});
		expect(state.cursor).toBe("cursor-3");
		expect(state.messages["message-1"]?.text).toBe("hello");
	});

	it("rejects malformed records rather than rendering inferred conversation content", function _RejectsMalformed()
	{
		expect(function _read(): void { __ReadConversationReplay("id: cursor-1\nevent: ag-ui\ndata: {bad}\n\n"); }).toThrow("invalid canonical conversation replay");
	});

	it("permits the authorised empty replay without disclosing an inferred thread state", function _AllowsEmpty()
	{
		const state = __ReadConversationReplay("");

		expect(state.cursor).toBeNull();
		expect(state.messages).toEqual({});
	});
});
