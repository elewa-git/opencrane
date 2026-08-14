import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, AG_UI_INTERRUPTS_CLEARED_EVENT, AG_UI_TOOL_FAILURE_EVENT, AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, AgentThreadDeliveryKinds, AgUiA2uiSurfaceStates, AgUiToolRecoveryProviderOutcomes } from "@opencrane/contracts";

import { __DecodeAgUiSseRecord } from "../ag-ui-sse-decoder.js";
import { AgUiMessageStatuses, AgUiRunStatuses, AgUiToolStatuses, type AgUiStreamRecord } from "../ag-ui-stream.types.js";
import { __AgUiResumeCursor, __CreateAgUiStreamState, __ReduceAgUiStream } from "../ag-ui-stream.js";

/** Exact safe progressive-disclosure fixture. */
function _ToolFailureEnvelope(failureCode = "AuthenticationError", retrying = true)
{
	return { eventType: "tool.failed" as const, toolCallId: "tool-1", failureCode, retrying, technicalDetails: { toolIdentifier: "tool-1", toolRevision: "revision-1", failureCategory: failureCode, summary: failureCode === "AuthenticationError" ? "Authentication failed." : "The tool attempt failed.", occurredAt: "2026-07-23T00:00:00.000Z", retryCount: 1, retryLimit: 3 } };
}

/** Decode one valid pinned projection frame or fail the focused test immediately. */
function _Record(id: string | undefined, data: object): AgUiStreamRecord
{
	const cursor = id === undefined ? "" : `id: ${id}\n`;
	const record = __DecodeAgUiSseRecord(`${cursor}event: ag-ui\ndata: ${JSON.stringify(data)}\n\n`);
	if (record === null) throw new Error("expected a valid projection record");
	return record;
}

/** Build one full-coordinate governed A2UI envelope for browser projection tests. */
function _A2ui(sequence: number, state: AgUiA2uiSurfaceStates, operations: readonly unknown[], overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>>
{
	return { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence, state, operations, ...overrides };
}

/** Wrap one governed A2UI envelope in its exact AG-UI CUSTOM event. */
function _A2uiRecord(id: string, envelope: Readonly<Record<string, unknown>>): AgUiStreamRecord
{
	return _Record(id, { type: EventType.CUSTOM, name: AG_UI_A2UI_ENVELOPE_VERSION, value: envelope });
}

/** Build one exact recovery-required envelope with optional malformed-test overrides. */
function _Recovery(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>>
{
	return {
		eventType: "tool.recovery_required",
		runId: "run-1",
		expectedAttempt: 2,
		toolCallId: "tool-1",
		occurredAt: "2026-08-11T08:30:00.000Z",
		recoveryCategory: "manual_action_required",
		preparationRetryCount: 3,
		preparationRetryLimit: 3,
		providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch,
		...overrides,
	};
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
		expect(state.tools["tool-1"]).toMatchObject({ arguments: "{\"q\":\"hello\"}", status: AgUiToolStatuses.Completed, result: "done", failureCode: null, failures: [] });
		expect(__AgUiResumeCursor(state)).toBe("cursor-8");
	});

	it("keeps a failed tool visibly failed with only its safe technical classification", function _ToolFailure()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-tool-1", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "search" }));
		state = __ReduceAgUiStream(state, _Record("cursor-tool-2", { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value: _ToolFailureEnvelope() }));

		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.Failed, failureCode: "AuthenticationError", result: null });
		expect(state.tools["tool-1"]?.failures).toEqual([{ code: "AuthenticationError", retrying: true, technicalDetails: _ToolFailureEnvelope().technicalDetails }]);
		expect(state.customEvents).toContain(AG_UI_TOOL_FAILURE_EVENT);
		expect(function _SecretExtension(): void
		{
			__ReduceAgUiStream(state, _Record("cursor-tool-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value: { ..._ToolFailureEnvelope(), detail: "secret" } }));
		}).toThrow("tool failure is invalid");
	});

	it("retains a failed attempt when a later tool result recovers", function _ToolRecovery()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-tool-1", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "search" }));
		state = __ReduceAgUiStream(state, _Record("cursor-tool-2", { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value: _ToolFailureEnvelope() }));
		state = __ReduceAgUiStream(state, _Record("cursor-tool-3", { type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-1", messageId: "tool-message-1", role: "tool", content: "recovered" }));

		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.Recovered, result: "recovered", failureCode: "AuthenticationError" });
		expect(state.tools["tool-1"]?.failures).toEqual([{ code: "AuthenticationError", retrying: true, technicalDetails: _ToolFailureEnvelope().technicalDetails }]);
	});

	it("stops a run in Needs recovery, preserves prior failure evidence, and accepts authoritative cancellation", function _NeedsRecovery()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-recovery-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_FAILURE_EVENT, value: _ToolFailureEnvelope("TimeoutError", false) }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-4", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: _Recovery() }));

		expect(state.runStatus).toBe(AgUiRunStatuses.NeedsRecovery);
		expect(state.runRecovery).toEqual(_Recovery());
		expect(state.interrupts).toEqual([]);
		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.NeedsRecovery, failureCode: "TimeoutError", failures: [{ code: "TimeoutError", retrying: false }], recovery: _Recovery() });
		expect(function _CannotGuessSuccess(): void
		{
			__ReduceAgUiStream(state, _Record("cursor-recovery-5", { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "success" } }));
		}).toThrow("cannot overwrite");

		state = __ReduceAgUiStream(state, _Record("cursor-recovery-6", { type: EventType.RUN_ERROR, message: "Run cancelled: user_cancelled", code: "RUN_CANCELLED" }));
		expect(state.runStatus).toBe(AgUiRunStatuses.Cancelled);
		expect(state.runRecovery).toEqual(_Recovery());
		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.NeedsRecovery, failures: [{ code: "TimeoutError", retrying: false }], recovery: _Recovery() });
	});

	it("rejects a tool end as proof of recovery", function _RejectsToolEndAfterRecoveryRequirement()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-recovery-end-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-end-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-end-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: _Recovery() }));
		const recoveryTool = state.tools["tool-1"];
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-end-4", { type: EventType.TOOL_CALL_END, toolCallId: "tool-1" }));

		expect(state.cursor).toBe("cursor-recovery-end-4");
		expect(state.tools["tool-1"]).toBe(recoveryTool);
		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.NeedsRecovery, result: null, recovery: _Recovery() });
	});

	it("rejects a tool result as proof of recovery", function _RejectsToolResultAfterRecoveryRequirement()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-recovery-result-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-result-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" }));
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-result-3", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value: _Recovery() }));
		const recoveryTool = state.tools["tool-1"];
		state = __ReduceAgUiStream(state, _Record("cursor-recovery-result-4", { type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-1", messageId: "tool-message-1", role: "tool", content: "done" }));

		expect(state.cursor).toBe("cursor-recovery-result-4");
		expect(state.tools["tool-1"]).toBe(recoveryTool);
		expect(state.tools["tool-1"]).toMatchObject({ status: AgUiToolStatuses.NeedsRecovery, result: null, recovery: _Recovery() });
	});

	it("rejects malformed and secret-bearing recovery envelopes without changing state", function _RejectsUnsafeRecovery()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-unsafe-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record("cursor-unsafe-2", { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "create_invoice" }));
		const invalid = [
			_Recovery({ expectedAttempt: 0 }),
			_Recovery({ preparationRetryCount: 4 }),
			_Recovery({ preparationRetryLimit: 4 }),
			_Recovery({ occurredAt: "not-an-instant" }),
			_Recovery({ providerOutcome: "Bearer secret" }),
			_Recovery({ providerBody: "secret response" }),
			_Recovery({ authorization: "Bearer secret" }),
			_Recovery({ password: "never" }),
		];

		for (const value of invalid)
		{
			expect(function _UnsafeEnvelope(): void
			{
				__ReduceAgUiStream(state, _Record("cursor-unsafe-value", { type: EventType.CUSTOM, name: AG_UI_TOOL_RECOVERY_REQUIRED_EVENT, value }));
			}).toThrow("recovery requirement is invalid");
		}
		expect(state.runStatus).toBe(AgUiRunStatuses.Running);
		expect(state.runRecovery).toBeNull();
		expect(state.tools["tool-1"]?.recovery).toBeNull();
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

	it("replaces and clears the complete open-interrupt set without advancing the durable cursor", function _InterruptOverlay()
	{
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record("cursor-1", { type: EventType.RUN_STARTED, threadId: "conversation-1", runId: "run-1" }));
		state = __ReduceAgUiStream(state, _Record(undefined, { type: EventType.RUN_FINISHED, threadId: "conversation-1", runId: "run-1", outcome: { type: "interrupt", interrupts: [{ id: "approval-1", reason: "tool_approval", toolCallId: "tool-1" }, { id: "approval-2", reason: "tool_approval", toolCallId: "tool-2" }] } }));

		expect(state.runStatus).toBe(AgUiRunStatuses.Interrupted);
		expect(state.interrupts.map(function _Id(interrupt): string { return interrupt.id; })).toEqual(["approval-1", "approval-2"]);
		expect(state.cursor).toBe("cursor-1");
		state = __ReduceAgUiStream(state, _Record(undefined, { type: EventType.CUSTOM, name: AG_UI_INTERRUPTS_CLEARED_EVENT, value: { eventType: AG_UI_INTERRUPTS_CLEARED_EVENT } }));
		expect(state.interrupts).toEqual([]);
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
		state = __ReduceAgUiStream(state, _A2uiRecord("cursor-3", _A2ui(0, AgUiA2uiSurfaceStates.Ready, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }])));
		state = __ReduceAgUiStream(state, _Record(undefined, { type: EventType.CUSTOM, name: "opencrane.access_revoked", value: { eventType: "access.revoked" } }));

		expect(state.accessRevoked).toBe(true);
		expect(state.cursor).toBeNull();
		expect(state.seenCursors.size).toBe(0);
		expect(state.messages).toEqual({});
		expect(state.tools).toEqual({});
		expect(state.surfaces.size).toBe(0);
		expect(state.interrupts).toEqual([]);
	});

	it("stores a renderable begin operation in supplied order under the full stable identity", function _StoresRenderableA2ui()
	{
		const operations = [
			{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "root-1", component: { Text: { text: { literalString: "Pricing" } } } }] } },
			{ dataModelUpdate: { surfaceId: "surface-1", contents: [{ key: "title", valueString: "Pricing" }] } },
			{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }
		];
		const envelope = _A2ui(0, AgUiA2uiSurfaceStates.Streaming, operations);
		const state = __ReduceAgUiStream(__CreateAgUiStreamState(), _A2uiRecord("cursor-a2ui-1", envelope));
		const stored = [...state.surfaces.values()][0];

		expect(state.surfaces.size).toBe(1);
		expect(stored).toEqual(envelope);
		expect(stored?.operations).toEqual(operations);
		expect(stored?.operations[2]).toEqual({ beginRendering: { surfaceId: "surface-1", root: "root-1" } });
	});

	it("adopts progressive authoritative lifecycle and reason without local inference", function _AdoptsProgressiveA2ui()
	{
		const first = _A2ui(0, AgUiA2uiSurfaceStates.Streaming, [{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "root-1", component: { Text: { text: { literalString: "Pricing" } } } }] } }]);
		const second = _A2ui(1, AgUiA2uiSurfaceStates.Expired, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }], { reason: "The server-declared action window expired" });
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _A2uiRecord("cursor-a2ui-1", first));
		state = __ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-2", second));
		const progressed = state;
		state = __ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-3", second));

		expect([...progressed.surfaces.values()][0]).toMatchObject({ sequence: 1, state: AgUiA2uiSurfaceStates.Expired, reason: "The server-declared action window expired" });
		expect([...progressed.surfaces.values()][0]?.operations).toEqual([...first.operations as readonly unknown[], ...second.operations as readonly unknown[]]);
		expect(state.surfaces).toEqual(progressed.surfaces);
		expect(state.customEvents).toEqual([AG_UI_A2UI_ENVELOPE_VERSION, AG_UI_A2UI_ENVELOPE_VERSION]);
	});

	it("rejects same-sequence mutation, regression, and sequence gaps", function _RejectsA2uiSequenceDrift()
	{
		const initial = _A2ui(2, AgUiA2uiSurfaceStates.Ready, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }]);
		const state = __ReduceAgUiStream(__CreateAgUiStreamState(), _A2uiRecord("cursor-a2ui-1", initial));
		expect(function _MutatedSequence(): void
		{
			__ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-2", _A2ui(2, AgUiA2uiSurfaceStates.Expired, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }])));
		}).toThrow("sequence changed payload");
		expect(function _RegressedSequence(): void
		{
			__ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-3", _A2ui(1, AgUiA2uiSurfaceStates.Streaming, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }])));
		}).toThrow("sequence regressed");
		expect(function _SequenceGap(): void
		{
			__ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-4", _A2ui(4, AgUiA2uiSurfaceStates.Ready, [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }])));
		}).toThrow("sequence has a gap");
	});

	it("keeps surfaces with one reused surface id separate across full coordinates", function _KeysA2uiByFullIdentity()
	{
		const operation = [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }];
		let state = __ReduceAgUiStream(__CreateAgUiStreamState(), _A2uiRecord("cursor-a2ui-1", _A2ui(0, AgUiA2uiSurfaceStates.Ready, operation)));
		state = __ReduceAgUiStream(state, _A2uiRecord("cursor-a2ui-2", _A2ui(0, AgUiA2uiSurfaceStates.Ready, operation, { messageId: "message-2" })));
		expect(state.surfaces.size).toBe(2);
		expect([...state.surfaces.values()].map(surface => surface.messageId)).toEqual(["message-1", "message-2"]);
	});

	it("rejects malformed governed A2UI custom values during strict SSE decoding", function _RejectsMalformedA2uiCustom()
	{
		const invalid = _A2ui(0, AgUiA2uiSurfaceStates.Ready, [{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "choice-1", component: { Select: {} } }] } }]);
		const frame = `id: cursor-a2ui\nevent: ag-ui\ndata: ${JSON.stringify({ type: EventType.CUSTOM, name: AG_UI_A2UI_ENVELOPE_VERSION, value: invalid })}\n\n`;
		expect(__DecodeAgUiSseRecord(frame)).toBeNull();
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

	it("adopts exact display-safe Agent-thread parent deliveries", function _AdoptsParentDelivery()
	{
		const delivery = { id: "delivery-1", childConversationId: "child-1", kind: AgentThreadDeliveryKinds.Failure, label: "Could not finish", detail: "Authentication failed. No result was delivered.", assetId: null };
		const record = _Record("cursor-delivery-1", { type: EventType.CUSTOM, name: AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, value: delivery });
		const state = __ReduceAgUiStream(__CreateAgUiStreamState(), record);

		expect(state.agentThreadParentDeliveries).toEqual({ "delivery-1": delivery });
		expect(state.customEvents).toContain(AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT);
	});

	it("rejects Agent-thread parent delivery secrets, extra fields, and changed ids", function _RejectsUnsafeParentDelivery()
	{
		const delivery = { id: "delivery-1", childConversationId: "child-1", kind: AgentThreadDeliveryKinds.Result, label: "Done", detail: "Ready.", assetId: null };
		const unsafe = _Record("cursor-delivery-unsafe", { type: EventType.CUSTOM, name: AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, value: { ...delivery, authorization: "Bearer secret" } });
		expect(function _Unsafe(): void { __ReduceAgUiStream(__CreateAgUiStreamState(), unsafe); }).toThrow("parent delivery is invalid");
		const accepted = __ReduceAgUiStream(__CreateAgUiStreamState(), _Record(undefined, { type: EventType.CUSTOM, name: AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, value: delivery }));
		expect(function _Changed(): void { __ReduceAgUiStream(accepted, _Record(undefined, { type: EventType.CUSTOM, name: AG_UI_AGENT_THREAD_PARENT_DELIVERY_EVENT, value: { ...delivery, detail: "Changed" } })); }).toThrow("changed payload");
	});
});
