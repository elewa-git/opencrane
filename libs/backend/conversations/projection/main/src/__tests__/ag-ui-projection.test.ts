import { EventSchemas } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { AG_UI_PROJECTION_VERSION, AG_UI_RUN_WAIT_STATE_EVENT, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, AgUiRunWaitOperations, AgUiRunWaitReasons, AgUiRunWaitSources, AgUiToolRecoveryProviderOutcomes, ___ParseAgUiRunWaitState, type AgUiProjectionEvent, type AgUiProjectionSourceEvent, type AgUiRunWaitStateEnvelope, type AgUiSseRecord } from "@opencrane/contracts";

import { __ProjectAgUiEvents } from "../ag-ui-event-projector";
import { __EncodeAgUiSseRecord } from "../ag-ui-sse-encoder";

/** Construct one server-authorized safe source event for projection tests. */
function _Source(eventType: AgUiProjectionSourceEvent["eventType"], payload: AgUiProjectionSourceEvent["payload"] = {}): AgUiProjectionSourceEvent
{
	return { cursor: "event-4", conversationId: "conversation-2", runId: "run-3", position: "9007199254740993", eventType, occurredAt: "2026-07-23T00:00:00.000Z", payload };
}

/** Select the minimum safe fields needed by one pinned-schema conformance fixture. */
function _ConformancePayload(eventType: string): AgUiProjectionSourceEvent["payload"]
{
	if (eventType.startsWith("message."))
		return { messageId: "message-1", delta: "hello" };
	if (eventType === "tool.requested")
		return { toolCallId: "tool-1", toolCallName: "search" };
	if (eventType === "tool.completed")
		return { toolCallId: "tool-1" };
	return {};
}

/** Select the one subframe produced by a non-message projection fixture. */
function _ProjectOne(source: AgUiProjectionSourceEvent): AgUiProjectionEvent
{
	const [event] = __ProjectAgUiEvents(source);
	if (event === undefined)
		throw new Error("projection fixture produced no AG-UI event");
	return event;
}

/** Wrap one projected subframe in the same bounded SSE record shape used by live replay. */
function _Record(source: AgUiProjectionSourceEvent): AgUiSseRecord
{
	return { ...(source.cursor === undefined ? {} : { id: source.cursor }), event: "ag-ui", data: _ProjectOne(source) };
}

/** Read one strict wait envelope from a projected custom event. */
function _WaitEnvelope(event: AgUiProjectionEvent | undefined): AgUiRunWaitStateEnvelope
{
	if (event?.type !== "CUSTOM" || event.name !== AG_UI_RUN_WAIT_STATE_EVENT)
		throw new Error("projection fixture produced no wait event");
	const envelope = ___ParseAgUiRunWaitState(event.value);
	if (envelope === null)
		throw new Error("projection fixture produced an invalid wait event");
	return envelope;
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

	it("projects outside-action wait changes without claiming that the tool needs approval", function _ProjectsToolWait()
	{
		const requested = __ProjectAgUiEvents(_Source("tool.requested", { toolCallId: "tool-1", toolCallName: "search" }));
		const completed = __ProjectAgUiEvents(_Source("tool.completed", { toolCallId: "tool-1" }));

		const requestedWait = _WaitEnvelope(requested[1]);
		const completedWait = _WaitEnvelope(completed[1]);
		expect(requestedWait).toMatchObject({ runId: "run-3", source: AgUiRunWaitSources.Runtime, operation: AgUiRunWaitOperations.Add, waits: [{ reason: AgUiRunWaitReasons.ExternalAction }] });
		expect(requestedWait.waits[0]?.id).toMatch(/^tool:[a-f0-9]{64}$/u);
		expect(completedWait).toMatchObject({ runId: "run-3", source: AgUiRunWaitSources.Runtime, operation: AgUiRunWaitOperations.Remove, waits: [{ id: requestedWait.waits[0]?.id, reason: AgUiRunWaitReasons.ExternalAction }] });
	});

	it("keeps wait identifiers bounded when the runtime uses its longest accepted tool-call id", function _BoundsToolWait()
	{
		const toolCallId = "x".repeat(256);
		const wait = _WaitEnvelope(__ProjectAgUiEvents(_Source("tool.requested", { toolCallId, toolCallName: "search" }))[1]);
		expect(wait.waits[0]?.id).toMatch(/^tool:[a-f0-9]{64}$/u);
		expect(wait.waits[0]?.id.length).toBeLessThanOrEqual(256);
	});

	it("projects tool failure with safe coordinates and technical classification", function _ProjectsToolFailure()
	{
		const technicalDetails = { toolIdentifier: "tool-1", toolRevision: "revision-1", failureCategory: "AuthenticationError", summary: "Authentication failed.", occurredAt: "2026-07-23T00:00:00.000Z", retryCount: 1, retryLimit: 3 };
		expect(_ProjectOne(_Source("tool.failed", { toolCallId: "tool-1", failureCode: "AuthenticationError", toolFailure: { retrying: true, technicalDetails } }))).toEqual({ type: "CUSTOM", name: AG_UI_TOOL_FAILURE_EVENT, value: { eventType: "tool.failed", toolCallId: "tool-1", failureCode: "AuthenticationError", retrying: true, technicalDetails } });
	});

	it("projects recovery as a distinct nonterminal custom event with only fixed safe evidence", function _ProjectsToolRecovery()
	{
		const toolRecovery = { eventType: "tool.recovery_required" as const, expectedAttempt: 2, toolCallId: "tool-1", recoveryCategory: "manual_action_required" as const, preparationRetryCount: 1, preparationRetryLimit: 3 as const, providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch };
		const events = __ProjectAgUiEvents(_Source("tool.recovery_required", { toolRecovery }));
		expect(events[0]).toEqual({ type: "CUSTOM", name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: { ...toolRecovery, runId: "run-3", occurredAt: "2026-07-23T00:00:00.000Z" } });
		expect(_WaitEnvelope(events[2])).toMatchObject({ runId: "run-3", source: AgUiRunWaitSources.Recovery, operation: AgUiRunWaitOperations.Add, waits: [{ id: expect.stringMatching(/^recovery:[a-f0-9]{64}$/u), reason: AgUiRunWaitReasons.RecoveryRequired }] });
	});

	it("retains every unsupported or incomplete canonical event as a payload-free custom signal", function _ProjectsCustom()
	{
		const eventTypes: readonly AgUiProjectionSourceEvent["eventType"][] = ["tool.started", "tool.progress", "context.compaction_started", "context.compaction_completed", "run.usage", "future.event"];
		for (const eventType of eventTypes)
		{
			expect(_ProjectOne(_Source(eventType, { delta: "do-not-forward" }))).toEqual({ type: "CUSTOM", name: `opencrane.${eventType.replaceAll(".", "_")}`, value: { eventType } });
		}
		expect(_ProjectOne(_Source("message.delta"))).toEqual({ type: "CUSTOM", name: "opencrane.message_delta", value: { eventType: "message.delta" } });
	});

	it("encodes a versioned projection as one bounded SSE record", function _EncodesSse()
	{
		const record = _Record(_Source("run.started"));
		expect(AG_UI_PROJECTION_VERSION).toBe("opencrane.ag-ui.v2");
		expect(__EncodeAgUiSseRecord(record)).toBe("id: event-4\nevent: ag-ui\ndata: {\"type\":\"RUN_STARTED\",\"threadId\":\"conversation-2\",\"runId\":\"run-3\"}\n\n");
	});

	it("re-presents an open interrupt without advancing the durable cursor", function _ProjectsInterruptOverlay()
	{
		const source = { ..._Source("elicitation.requested", { interrupt: { id: "elicitation-1", reason: "tool_approval", toolCallId: "tool-1", expiresAt: "2026-07-23T00:05:00.000Z", responseSchema: { type: "object" } } }), cursor: undefined };
		const record = _Record(source);
		expect(record.id).toBeUndefined();
		expect(record.data).toEqual({ type: "RUN_FINISHED", threadId: "conversation-2", runId: "run-3", outcome: { type: "interrupt", interrupts: [source.payload.interrupt] } });
		expect(__EncodeAgUiSseRecord(record)).not.toContain("id:");
		const wait = __ProjectAgUiEvents(source)[1];
		expect(_WaitEnvelope(wait)).toMatchObject({ runId: "run-3", source: AgUiRunWaitSources.Participant, operation: AgUiRunWaitOperations.Add, waits: [{ id: expect.stringMatching(/^interrupt:[a-f0-9]{64}$/u), reason: AgUiRunWaitReasons.Approval }] });
	});

	it("keeps personal-memory permission distinct from ordinary participant input", function _ProjectsParticipantReasons()
	{
		const participant = __ProjectAgUiEvents(_Source("elicitation.requested", { interrupt: { id: "input-1", reason: "runtime_input" } }))[1];
		const memory = __ProjectAgUiEvents(_Source("elicitation.requested", { interrupt: { id: "memory-1", reason: "personal_memory_permission" } }))[1];

		expect(participant).toMatchObject({ value: { waits: [{ reason: AgUiRunWaitReasons.ParticipantInput }] } });
		expect(memory).toMatchObject({ value: { waits: [{ reason: AgUiRunWaitReasons.PersonalMemoryPermission }] } });
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
