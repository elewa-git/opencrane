import { EventSchemas } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { AG_UI_PROJECTION_VERSION, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, AgUiToolRecoveryProviderOutcomes, type AgUiProjectionEvent, type AgUiProjectionSourceEvent, type AgUiSseRecord } from "@opencrane/contracts";

import { __ProjectAgUiEvents } from "../ag-ui-event-projector.js";
import { __EncodeAgUiSseRecord } from "../ag-ui-sse-encoder.js";

/** Construct one server-authorized safe source event for projection tests. */
function _Source(eventType: AgUiProjectionSourceEvent["eventType"], payload: AgUiProjectionSourceEvent["payload"] = {}): AgUiProjectionSourceEvent
{
	return { cursor: "event-4", conversationId: "conversation-2", runId: "run-3", position: "9007199254740993", eventType, occurredAt: "2026-07-23T00:00:00.000Z", payload };
}

/** Select the minimum safe fields needed by one pinned-schema conformance fixture. */
function _ConformancePayload(eventType: string): AgUiProjectionSourceEvent["payload"]
{
	if (eventType.startsWith("message.")) return { messageId: "message-1", delta: "hello" };
	if (eventType === "tool.requested") return { toolCallId: "tool-1", toolCallName: "search" };
	if (eventType === "tool.completed") return { toolCallId: "tool-1" };
	return {};
}

/** Select the one subframe produced by a non-message projection fixture. */
function _ProjectOne(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	const [event] = __ProjectAgUiEvents(source);
	if (event === undefined) throw new Error("projection fixture produced no AG-UI event");
	return event;
}

/** Wrap one projected subframe in the same bounded SSE record shape used by live replay. */
function _Record(source: AgUiProjectionSourceEvent): AgUiSseRecord
{
	return { ...(source.cursor === undefined ? {} : { id: source.cursor }), event: "ag-ui", data: _ProjectOne(source) };
}

describe("AG-UI projection", function _Suite()
{
	it("projects run lifecycle events with the standardized AG-UI thread field", function _ProjectsLifecycle()
	{
		expect(_ProjectOne(_Source("run.accepted"))).toEqual({ type: "RUN_STARTED", threadId: "conversation-2", runId: "run-3" });
		expect(_ProjectOne(_Source("run.started"))).toEqual({ type: "RUN_STARTED", threadId: "conversation-2", runId: "run-3" });
		expect(_ProjectOne(_Source("run.completed"))).toEqual({ type: "RUN_FINISHED", threadId: "conversation-2", runId: "run-3", outcome: { type: "success" } });
		expect(_ProjectOne(_Source("run.failed", { terminalReason: "runtime_failure", failureCode: "AUTHENTICATION_FAILED" }))).toEqual({ type: "RUN_ERROR", message: "Run failed: runtime_failure", code: "AUTHENTICATION_FAILED" });
		expect(_ProjectOne(_Source("run.cancelled", { terminalReason: "user_cancelled" }))).toEqual({ type: "RUN_ERROR", message: "Run cancelled: user_cancelled", code: "RUN_CANCELLED" });
	});

	it("projects safe message and tool identifiers but never an untrusted tool result", function _ProjectsSafeFields()
	{
		expect(_ProjectOne(_Source("message.started", { messageId: "message-1" }))).toEqual({ type: "TEXT_MESSAGE_START", messageId: "message-1", role: "assistant" });
		expect(_ProjectOne(_Source("message.delta", { messageId: "message-1", delta: "hello" }))).toEqual({ type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: "hello" });
		expect(_ProjectOne(_Source("message.completed", { messageId: "message-1" }))).toEqual({ type: "TEXT_MESSAGE_END", messageId: "message-1" });
		expect(_ProjectOne(_Source("tool.requested", { toolCallId: "tool-1", toolCallName: "search" }))).toEqual({ type: "TOOL_CALL_START", toolCallId: "tool-1", toolCallName: "search" });
		expect(_ProjectOne(_Source("tool.completed", { toolCallId: "tool-1", toolResult: "AWS_SECRET_ACCESS_KEY=never-forwarded" }))).toEqual({ type: "TOOL_CALL_END", toolCallId: "tool-1" });
	});

	it("projects tool failure with safe coordinates and technical classification", function _ProjectsToolFailure()
	{
		const technicalDetails = { toolIdentifier: "tool-1", toolRevision: "revision-1", failureCategory: "AuthenticationError", summary: "Authentication failed.", occurredAt: "2026-07-23T00:00:00.000Z", retryCount: 1, retryLimit: 3 };
		expect(_ProjectOne(_Source("tool.failed", { toolCallId: "tool-1", failureCode: "AuthenticationError", toolFailure: { retrying: true, technicalDetails } }))).toEqual({ type: "CUSTOM", name: AG_UI_TOOL_FAILURE_EVENT, value: { eventType: "tool.failed", toolCallId: "tool-1", failureCode: "AuthenticationError", retrying: true, technicalDetails } });
	});

	it("projects recovery as a distinct nonterminal custom event with only fixed safe evidence", function _ProjectsToolRecovery()
	{
		const toolRecovery = { eventType: "tool.recovery_required" as const, expectedAttempt: 2, toolCallId: "tool-1", recoveryCategory: "manual_action_required" as const, preparationRetryCount: 1, preparationRetryLimit: 3 as const, providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch };
		expect(_ProjectOne(_Source("tool.recovery_required", { toolRecovery }))).toEqual({ type: "CUSTOM", name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: { ...toolRecovery, runId: "run-3", occurredAt: "2026-07-23T00:00:00.000Z" } });
	});

	it("retains every unsupported or incomplete canonical event as a payload-free custom signal", function _ProjectsCustom()
	{
		const eventTypes: readonly AgUiProjectionSourceEvent["eventType"][] = ["tool.started", "tool.progress", "tool.approval_required", "context.compaction_started", "context.compaction_completed", "run.usage", "future.event"];
		for (const eventType of eventTypes)
		{
			expect(_ProjectOne(_Source(eventType, { delta: "do-not-forward" }))).toEqual({ type: "CUSTOM", name: `opencrane.${eventType.replaceAll(".", "_")}`, value: { eventType } });
		}
		expect(_ProjectOne(_Source("message.delta"))).toEqual({ type: "CUSTOM", name: "opencrane.message_delta", value: { eventType: "message.delta" } });
	});

	it("encodes a versioned projection as one bounded SSE record", function _EncodesSse()
	{
		const record = _Record(_Source("run.started"));
		expect(AG_UI_PROJECTION_VERSION).toBe("opencrane.ag-ui.v1");
		expect(__EncodeAgUiSseRecord(record)).toBe("id: event-4\nevent: ag-ui\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"conversation-2\",\"runId\":\"run-3\"}\n\n");
	});

	it("re-presents an open interrupt without advancing the durable cursor", function _ProjectsInterruptOverlay()
	{
		const source = { ..._Source("tool.approval_required", { interrupt: { id: "approval-1", reason: "tool_approval", toolCallId: "tool-1", expiresAt: "2026-07-23T00:05:00.000Z", responseSchema: { type: "object" } } }), cursor: undefined };
		const record = _Record(source);
		expect(record.id).toBeUndefined();
		expect(record.data).toEqual({ type: "RUN_FINISHED", threadId: "conversation-2", runId: "run-3", outcome: { type: "interrupt", interrupts: [source.payload.interrupt] } });
		expect(__EncodeAgUiSseRecord(record)).not.toContain("id:");
	});

	it("produces events accepted by the exact-pinned AG-UI schemas", function _ConformsToPinnedSchemas()
	{
		for (const eventType of ["run.started", "run.completed", "run.failed", "run.cancelled", "message.started", "message.delta", "message.completed", "tool.requested", "tool.completed", "future.event"])
		{
			const event = _ProjectOne(_Source(eventType, _ConformancePayload(eventType)));
			expect(EventSchemas.safeParse(event).success).toBe(true);
		}
	});

	it("refuses a cursor that could inject a second SSE field", function _RejectsInjectedCursor()
	{
		const record = _Record({ ..._Source("run.started"), cursor: "event-4\nevent: forged" });
		expect(() => __EncodeAgUiSseRecord(record)).toThrow("invalid SSE cursor");
	});

});
