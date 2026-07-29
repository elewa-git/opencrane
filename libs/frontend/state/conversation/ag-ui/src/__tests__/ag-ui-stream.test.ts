import { describe, expect, it } from "vitest";

import { __AgUiResumeCursor, __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream } from "../ag-ui-stream.js";

/** Decode one valid projection frame or fail the focused test immediately. */
function _Record(id: string, data: object)
{
	const record = __DecodeAgUiSseRecord(`id: ${id}\nevent: ag-ui\ndata: ${JSON.stringify(data)}\n\n`);
	if (!record) throw new Error("expected a valid projection record");
	return record;
}

describe("AG-UI stream state", function _Suite()
{
	it("assembles text, tools, custom signals, and a reconnect cursor", function _Assembles()
	{
		let state = __CreateAgUiStreamState();
		state = __ReduceAgUiStream(state, _Record("event-9", { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("event-10", { type: "TEXT_MESSAGE_START", messageId: "message-1", role: "assistant" }));
		state = __ReduceAgUiStream(state, _Record("event-11", { type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: "hello" }));
		state = __ReduceAgUiStream(state, _Record("event-12", { type: "TOOL_CALL_START", toolCallId: "tool-1", toolCallName: "search" }));
		state = __ReduceAgUiStream(state, _Record("event-13", { type: "TOOL_CALL_RESULT", toolCallId: "tool-1", content: "done" }));
		state = __ReduceAgUiStream(state, _Record("event-14", { type: "CUSTOM", name: "opencrane.approval_required", value: { eventType: "tool.approval_required" } }));
		expect(state.runId).toBe("run-1");
		expect(state.messages["message-1"]?.text).toBe("hello");
		expect(state.tools["tool-1"]).toMatchObject({ complete: true, result: "done" });
		expect(state.customEvents).toEqual(["opencrane.approval_required"]);
		expect(__AgUiResumeCursor(state)).toBe("event-14");
	});

	it("suppresses exact replay without dropping opaque cursor ten", function _SuppressesReplay()
	{
		let state = __CreateAgUiStreamState();
		state = __ReduceAgUiStream(state, _Record("event-9", { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("event-10", { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" }));
		const replayed = __ReduceAgUiStream(state, _Record("event-10", { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" }));
		expect(state.cursor).toBe("event-10");
		expect(replayed).toBe(state);
	});

	it("fails closed on malformed, unknown, and incomplete records", function _FailsClosed()
	{
		expect(__DecodeAgUiSseRecord("id: event-1\nevent: ag-ui\ndata: {bad}\n\n")).toBeNull();
		expect(__DecodeAgUiSseRecord("id: event-1\nevent: ag-ui\ndata: {\"type\":\"RUN_STARTED\"}\n\n")).toBeNull();
		expect(__DecodeAgUiSseRecord("id: event-1\nevent: ag-ui\ndata: null\n\n")).toBeNull();
		expect(__DecodeAgUiSseRecord("id: event-1\nevent: ag-ui\ndata: []\n\n")).toBeNull();
		expect(__DecodeAgUiSseRecord("id: event-1\nevent: other\ndata: {}\n\n")).toBeNull();
	});

	it("accepts CRLF framing and consumes an orphaned record for reconnect progress", function _ConsumesSafely()
	{
		const record = __DecodeAgUiSseRecord("id: event-1\r\nevent: ag-ui\r\ndata: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"messageId\":\"missing\",\"delta\":\"hello\"}\r\n\r\n");
		if (!record) throw new Error("expected a valid CRLF record");
		const state = __ReduceAgUiStream(__CreateAgUiStreamState(), record);
		expect(state.cursor).toBe("event-1");
		expect(state.messages).toEqual({});
	});
});
