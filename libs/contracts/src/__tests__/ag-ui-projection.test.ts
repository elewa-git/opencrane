import { EventSchemas } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { AG_UI_PROJECTION_VERSION, __EncodeAgUiSseRecord, __ProjectAgUiEvent, type AgUiProjectionSourceEvent } from "../index.js";

/** Construct one server-authorized safe source event for projection tests. */
function _Source(eventType: AgUiProjectionSourceEvent["eventType"], payload: AgUiProjectionSourceEvent["payload"] = {}): AgUiProjectionSourceEvent
{
	return { cursor: "event-4", conversationId: "conversation-2", runId: "run-3", position: "9007199254740993", eventType, occurredAt: "2026-07-23T00:00:00.000Z", payload };
}

describe("AG-UI projection", function _Suite()
{
	it("projects run lifecycle events with the standardized AG-UI thread field", function _ProjectsLifecycle()
	{
		expect(__ProjectAgUiEvent(_Source("run.accepted")).data).toEqual({ type: "RUN_STARTED", threadId: "conversation-2", runId: "run-3" });
		expect(__ProjectAgUiEvent(_Source("run.started")).data).toEqual({ type: "RUN_STARTED", threadId: "conversation-2", runId: "run-3" });
		expect(__ProjectAgUiEvent(_Source("run.completed")).data).toEqual({ type: "RUN_FINISHED", threadId: "conversation-2", runId: "run-3", outcome: { type: "success" } });
		expect(__ProjectAgUiEvent(_Source("run.failed", { terminalReason: "runtime_failure", failureCode: "AUTHENTICATION_FAILED" })).data).toEqual({ type: "RUN_ERROR", message: "Run failed: runtime_failure", code: "AUTHENTICATION_FAILED" });
		expect(__ProjectAgUiEvent(_Source("run.cancelled", { terminalReason: "user_cancelled" })).data).toEqual({ type: "RUN_ERROR", message: "Run cancelled: user_cancelled", code: "RUN_CANCELLED" });
	});

	it("projects safe message and tool identifiers but never an untrusted tool result", function _ProjectsSafeFields()
	{
		expect(__ProjectAgUiEvent(_Source("message.started", { messageId: "message-1" })).data).toEqual({ type: "TEXT_MESSAGE_START", messageId: "message-1", role: "assistant" });
		expect(__ProjectAgUiEvent(_Source("message.delta", { messageId: "message-1", delta: "hello" })).data).toEqual({ type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: "hello" });
		expect(__ProjectAgUiEvent(_Source("message.completed", { messageId: "message-1" })).data).toEqual({ type: "TEXT_MESSAGE_END", messageId: "message-1" });
		expect(__ProjectAgUiEvent(_Source("tool.requested", { toolCallId: "tool-1", toolCallName: "search" })).data).toEqual({ type: "TOOL_CALL_START", toolCallId: "tool-1", toolCallName: "search" });
		expect(__ProjectAgUiEvent(_Source("tool.completed", { toolCallId: "tool-1", toolResult: "AWS_SECRET_ACCESS_KEY=never-forwarded" })).data).toEqual({ type: "TOOL_CALL_END", toolCallId: "tool-1" });
	});

	it("retains every unsupported or incomplete canonical event as a payload-free custom signal", function _ProjectsCustom()
	{
		const eventTypes: readonly AgUiProjectionSourceEvent["eventType"][] = ["tool.started", "tool.progress", "tool.approval_required", "context.compaction_started", "context.compaction_completed", "run.usage", "future.event"];
		for (const eventType of eventTypes)
		{
			expect(__ProjectAgUiEvent(_Source(eventType, { delta: "do-not-forward" })).data).toEqual({ type: "CUSTOM", name: `opencrane.${eventType.replaceAll(".", "_")}`, value: { eventType } });
		}
		expect(__ProjectAgUiEvent(_Source("message.delta")).data).toEqual({ type: "CUSTOM", name: "opencrane.message_delta", value: { eventType: "message.delta" } });
	});

	it("encodes a versioned projection as one bounded SSE record", function _EncodesSse()
	{
		const record = __ProjectAgUiEvent(_Source("run.started"));
		expect(AG_UI_PROJECTION_VERSION).toBe("opencrane.ag-ui.v1");
		expect(__EncodeAgUiSseRecord(record)).toBe("id: event-4\nevent: ag-ui\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"conversation-2\",\"runId\":\"run-3\"}\n\n");
	});

	it("re-presents an open interrupt without advancing the durable cursor", function _ProjectsInterruptOverlay()
	{
		const source = { ..._Source("tool.approval_required", { interrupt: { id: "approval-1", reason: "tool_approval", toolCallId: "tool-1", expiresAt: "2026-07-23T00:05:00.000Z", responseSchema: { type: "object" } } }), cursor: undefined };
		const record = __ProjectAgUiEvent(source);
		expect(record.id).toBeUndefined();
		expect(record.data).toEqual({ type: "RUN_FINISHED", threadId: "conversation-2", runId: "run-3", outcome: { type: "interrupt", interrupts: [source.payload.interrupt] } });
		expect(__EncodeAgUiSseRecord(record)).not.toContain("id:");
	});

	it("produces events accepted by the exact-pinned AG-UI schemas", function _ConformsToPinnedSchemas()
	{
		for (const eventType of ["run.started", "run.completed", "run.failed", "run.cancelled", "message.started", "message.delta", "message.completed", "tool.requested", "tool.completed", "future.event"])
		{
			const payload = eventType.startsWith("message.") ? { messageId: "message-1", delta: "hello" } : eventType === "tool.requested" ? { toolCallId: "tool-1", toolCallName: "search" } : eventType === "tool.completed" ? { toolCallId: "tool-1" } : {};
			const event = __ProjectAgUiEvent(_Source(eventType, payload)).data;
			expect(EventSchemas.safeParse(event).success).toBe(true);
		}
	});

	it("refuses a cursor that could inject a second SSE field", function _RejectsInjectedCursor()
	{
		const record = __ProjectAgUiEvent({ ..._Source("run.started"), cursor: "event-4\nevent: forged" });
		expect(() => __EncodeAgUiSseRecord(record)).toThrow("invalid SSE cursor");
	});
});
