import { describe, expect, it } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, AgUiToolRecoveryProviderOutcomes } from "@opencrane/contracts";

import { __ProjectConversationReplayEvent } from "../replay-projection.js";
import type { ConversationReplayEventRow } from "../replay-projection.types.js";

/** Build one canonical A2UI replay row around an overrideable governed envelope. */
function _A2uiRow(a2ui: Readonly<Record<string, unknown>>, type = "a2ui.surface.updated"): ConversationReplayEventRow
{
	return { cursor: "c.a2ui", conversationId: "conversation-1", runId: "run-1", position: "2", type, payload: { a2ui }, occurredAt: "2026-07-23T10:00:01.000Z" };
}

/** Build the complete stable coordinate envelope used by focused replay tests. */
function _A2uiEnvelope(operations: readonly unknown[], sequence = 0): Readonly<Record<string, unknown>>
{
	return { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence, state: AgUiA2uiSurfaceStates.Streaming, operations };
}

/** Build one upstream-schema-valid instance of every admitted component wrapper. */
function _A2uiCatalogueComponents(): readonly unknown[]
{
	return [
		{ id: "text-1", component: { Text: { text: { literalString: "Pricing" } } } },
		{ id: "button-1", component: { Button: { child: "text-1", action: { name: "review-pricing" } } } },
		{ id: "field-1", component: { TextField: { label: { literalString: "Name" } } } },
		{ id: "single-choice-1", component: { SingleChoice: { selections: { literalArray: [] }, options: [{ label: { literalString: "One" }, value: "one" }], maxAllowedSelections: 1 } } },
		{ id: "choice-1", component: { MultipleChoice: { selections: { literalArray: [] }, options: [{ label: { literalString: "One" }, value: "one" }] } } },
		{ id: "select-1", component: { Select: { selections: { literalArray: [] }, options: [{ label: { literalString: "One" }, value: "one" }], maxAllowedSelections: 1 } } },
		{ id: "slider-1", component: { Slider: { value: { literalNumber: 1 } } } },
		{ id: "date-1", component: { DateTimeInput: { value: { literalString: "2026-08-11" }, enableDate: true } } },
		{ id: "image-1", component: { Image: { url: { literalString: "https://example.invalid/image.png" } } } },
		{ id: "card-1", component: { Card: { child: "text-1" } } },
		{ id: "list-1", component: { List: { children: { explicitList: ["text-1"] } } } }
	];
}

describe("conversation timeline projection", function _Suite()
{
	it("copies only display-safe message fields", function _Redacts()
	{
		const projected = __ProjectConversationReplayEvent({ cursor: "c.cursor", conversationId: "conversation-1", runId: "run-1", position: "1", type: "message.delta", payload: { messageId: "message-1", delta: "hello", capabilityProof: "secret", fence: 3 }, occurredAt: "2026-07-23T10:00:00.000Z" });
		expect(projected?.payload).toEqual({ messageId: "message-1", delta: "hello" });
	});

	it("shows safe tool and runtime failures without secret-bearing technical detail", function _ProjectsFailures()
	{
		const tool = __ProjectConversationReplayEvent({ cursor: "c.tool", conversationId: "conversation-1", runId: "run-1", position: "2", type: "tool.failed", payload: { toolInvocationId: "tool-1", reason: "external_action_preparation_failed", errorType: "AuthenticationError", authorization: "Bearer never", responseBody: "secret" }, occurredAt: "2026-07-23T10:00:01.000Z" });
		const runtime = __ProjectConversationReplayEvent({ cursor: "c.error", conversationId: "conversation-1", runId: "run-1", position: "3", type: "run.error", payload: { reason: "model_loop_error", errorType: "AuthenticationError", detail: "Bearer never" }, occurredAt: "2026-07-23T10:00:02.000Z" });

		expect(tool?.payload).toEqual({ toolCallId: "tool-1", failureCode: "AuthenticationError" });
		expect(runtime?.payload).toEqual({ failureCode: "AuthenticationError" });
		expect(JSON.stringify([tool, runtime])).not.toContain("Bearer never");
		expect(__ProjectConversationReplayEvent({ cursor: "c.secret", conversationId: "conversation-1", runId: "run-1", position: "4", type: "run.error", payload: { errorType: "SecretToken123" }, occurredAt: "2026-07-23T10:00:03.000Z" })?.payload).toEqual({});
	});

	it("projects only fixed recovery evidence and strips provider detail", function _ProjectsRecovery()
	{
		const recovery = __ProjectConversationReplayEvent({ cursor: "c.recovery", conversationId: "conversation-1", runId: "run-1", position: "4", type: "tool.recovery_required", payload: { toolInvocationId: "tool-1", expectedAttempt: 2, preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch, providerBody: "secret", arguments: { password: "never" } }, occurredAt: "2026-07-23T10:00:03.000Z" });
		expect(recovery?.payload).toEqual({ toolRecovery: { eventType: "tool.recovery_required", expectedAttempt: 2, toolCallId: "tool-1", recoveryCategory: "manual_action_required", preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: AgUiToolRecoveryProviderOutcomes.UnknownAfterDispatch } });
		expect(JSON.stringify(recovery)).not.toContain("secret");
	});

	it("drops unsupported payloads and invalid canonical rows", function _FailsClosed()
	{
		expect(__ProjectConversationReplayEvent({ cursor: "c.cursor", conversationId: "conversation-1", runId: "run-1", position: "1", type: "run.usage", payload: { providerKey: "secret" }, occurredAt: "2026-07-23T10:00:00.000Z" })?.payload).toEqual({});
		expect(__ProjectConversationReplayEvent({ cursor: "", conversationId: "conversation-1", runId: "run-1", position: "1", type: "run.started", payload: {}, occurredAt: "2026-07-23T10:00:00.000Z" })).toBeNull();
	});

	it("adopts exact ordered A2UI operations, lifecycle, and display-safe reason", function _ProjectsGovernedA2ui()
	{
		const operations = [
			{ surfaceUpdate: { surfaceId: "surface-1", components: _A2uiCatalogueComponents() } },
			{ dataModelUpdate: { surfaceId: "surface-1", contents: [{ key: "status", valueString: "ready" }] } },
			{ beginRendering: { surfaceId: "surface-1", root: "text-1" } }
		];
		const envelope = { ..._A2uiEnvelope(operations, 4), state: AgUiA2uiSurfaceStates.Ready, reason: "Ready for review" };
		const projected = __ProjectConversationReplayEvent(_A2uiRow(envelope, "a2ui.rendering.begun"));

		expect(projected?.payload.a2ui).toEqual(envelope);
		expect(projected?.payload.a2ui?.operations).toEqual(operations);
	});

	it("rejects A2UI operation, catalogue, coordinate, and envelope drift", function _RejectsA2uiDrift()
	{
		const cases = [
			_A2uiEnvelope([{ deleteSurface: { surfaceId: "surface-1" } }]),
			_A2uiEnvelope([{ beginRendering: { surfaceId: "surface-other", root: "root-1" } }]),
			_A2uiEnvelope([{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "choice-1", component: { SingleChoice: {} } }] } }]),
			{ ..._A2uiEnvelope([{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }]), conversationId: "conversation-other" },
			{ ..._A2uiEnvelope([{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }]), state: "locally_inferred" },
			{ ..._A2uiEnvelope([{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }]), capabilityProof: "forbidden" }
		];
		for (const envelope of cases) expect(__ProjectConversationReplayEvent(_A2uiRow(envelope))?.payload).toEqual({});
	});
});
