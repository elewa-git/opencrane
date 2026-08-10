import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { AgUiMessageStatuses, AgUiRunStatuses, type AgUiStreamRecord } from "../ag-ui-stream.types.js";
import { __AgUiResumeCursor, __CreateAgUiStreamState, __DecodeAgUiSseRecord, __ReduceAgUiStream } from "../ag-ui-stream.js";

/** Decode one valid pinned projection frame or fail the focused test immediately. */
function _Record(id: string | undefined, data: object): AgUiStreamRecord
{
	const cursor = id === undefined ? "" : `id: ${id}\n`;
	const record = __DecodeAgUiSseRecord(`${cursor}event: ag-ui\ndata: ${JSON.stringify(data)}\n\n`);
	if (record === null) throw new Error("expected a valid projection record");
	return record;
}

describe("AG-UI stream state", function _Suite()
{
	it("strictly assembles pinned text, tool, and successful run events", function _Assembles()
	{
		let state = __CreateAgUiStreamState();
		state = __ReduceAgUiStream(state, _Record("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-2", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" }));
		state = __ReduceAgUiStream(state, _Record("cursor-3", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "hello" }));
		state = __ReduceAgUiStream(state, _Record("cursor-4", { type: EventType.TEXT_MESSAGE_END, messageId: "message-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-5", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "search" }));
		state = __ReduceAgUiStream(state, _Record("cursor-6", { type: EventType.TOOL_CALL_ARGS, toolCallId: "tool-1", delta: "{\"q\":\"hello\"}" }));
		state = __ReduceAgUiStream(state, _Record("cursor-7", { type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-1", messageId: "tool-message-1", role: "tool", content: "done" }));
		state = __ReduceAgUiStream(state, _Record("cursor-8", { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "success" } }));

		expect(state.runStatus).toBe(AgUiRunStatuses.Succeeded);
		expect(state.messages["message-1"]).toMatchObject({ text: "hello", status: AgUiMessageStatuses.Completed });
		expect(state.tools["tool-1"]).toMatchObject({ arguments: "{\"q\":\"hello\"}", complete: true, result: "done" });
		expect(__AgUiResumeCursor(state)).toBe("cursor-8");
	});

	it("suppresses exact duplicate cursors and rejects cursor payload mutation", function _RejectsMutation()
	{
		const started = _Record("opaque-cursor", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" });
		const state = __ReduceAgUiStream(__CreateAgUiStreamState(), started);

		expect(__ReduceAgUiStream(state, started)).toBe(state);
		expect(function _Mutate(): void
		{
			__ReduceAgUiStream(state, _Record("opaque-cursor", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-2" }));
		}).toThrow("cursor changed payload");
	});

	it("re-presents open interrupts without advancing the durable cursor", function _InterruptOverlay()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record(undefined, { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "interrupt", interrupts: [{ id: "approval-1", reason: "tool_approval", toolCallId: "tool-1" }] } }));

		expect(state.runStatus).toBe(AgUiRunStatuses.Interrupted);
		expect(state.interrupts).toEqual([{ id: "approval-1", reason: "tool_approval", toolCallId: "tool-1" }]);
		expect(state.cursor).toBe("cursor-1");
	});

	it("keeps failure and cancellation truthful against later success", function _TruthfulTerminal()
	{
		let failed = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		failed = __ReduceAgUiStream(failed, _Record("cursor-2", { type: EventType.RUN_ERROR, message: "provider failed", code: "PROVIDER_FAILED" }));
		expect(failed.runStatus).toBe(AgUiRunStatuses.Failed);
		expect(function _OverwriteFailure(): void
		{
			__ReduceAgUiStream(failed, _Record("cursor-3", { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "success" } }));
		}).toThrow("cannot overwrite");

		let cancelled = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-a", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-2" }));
		cancelled = __ReduceAgUiStream(cancelled, _Record("cursor-b", { type: EventType.RUN_ERROR, message: "Run cancelled", code: "RUN_CANCELLED" }));
		expect(cancelled.runStatus).toBe(AgUiRunStatuses.Cancelled);
	});

	it("purges the browser projection immediately when stream authority is revoked", function _PurgesRevoked()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-1", { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "user" }));
		state = __ReduceAgUiStream(state, _Record("cursor-2", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "sensitive" }));
		state = __ReduceAgUiStream(state, _Record(undefined, { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } }));

		expect(state.accessRevoked).toBe(true);
		expect(state.cursor).toBeNull();
		expect(state.seenCursors.size).toBe(0);
		expect(state.messages).toEqual({});
		expect(state.tools).toEqual({});
		expect(state.interrupts).toEqual([]);
	});

	it("fails closed on unsupported pinned events, malformed data, and sequence gaps", function _FailsClosed()
	{
		expect(__DecodeAgUiSseRecord("id: cursor-1\nevent: ag-ui\ndata: {bad}\n\n")).toBeNull();
		expect(__DecodeAgUiSseRecord(`id: cursor-1\nevent: ag-ui\ndata: ${JSON.stringify({ type: EventType.STATE_SNAPSHOT, snapshot: {} })}\n\n`)).toBeNull();
		expect(function _Gap(): void
		{
			__ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-1", { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "missing", delta: "hello" }));
		}).toThrow("no active message");
	});
});
