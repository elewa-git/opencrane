import { describe, expect, it } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, ___ParseAgUiA2uiEnvelope } from "../index";

describe("AG-UI A2UI envelope", function _Suite()
{
	it("admits ordered begin-rendering operations and every authoritative surface lifecycle", function _AdmitsGovernedA2ui()
	{
		const operations = [
			{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "root-1", component: { Text: { text: { literalString: "Pricing" } } } }] } },
			{ dataModelUpdate: { surfaceId: "surface-1", contents: [{ key: "status", valueString: "ready" }] } },
			{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }
		];
		for (const state of Object.values(AgUiA2uiSurfaceStates))
		{
			const envelope = ___ParseAgUiA2uiEnvelope({ version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence: 0, state, operations, reason: "Server-selected display state" });
			expect(envelope.operations).toEqual(operations);
			expect(envelope.state).toBe(state);
		}
		expect(Object.values(AgUiA2uiSurfaceStates)).toHaveLength(10);
	});

	it("maps accepted choice variants onto the pinned schema and rejects protocol drift", function _RejectsGovernedA2uiDrift()
	{
		const base = { version: AG_UI_A2UI_ENVELOPE_VERSION, conversationId: "conversation-1", runId: "run-1", messageId: "message-1", surfaceId: "surface-1", sequence: 0, state: AgUiA2uiSurfaceStates.Streaming };
		const choice = { selections: { literalArray: [] }, options: [{ label: { literalString: "One" }, value: "one" }], maxAllowedSelections: 1 };
		expect(___ParseAgUiA2uiEnvelope({ ...base, operations: [{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "choice-1", component: { SingleChoice: choice } }, { id: "select-1", component: { Select: choice } }] } }] }).operations).toHaveLength(1);
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "choice-1", component: { SingleChoice: { ...choice, maxAllowedSelections: 2 } } }] } }] })).toThrow("operations");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ surfaceUpdate: { surfaceId: "surface-1", components: [{ id: "choice-1", component: { Choice: choice } }] } }] })).toThrow("operations");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ beginRendering: { surfaceId: "surface-2", root: "root-1" } }] })).toThrow("operations");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ deleteSurface: { surfaceId: "surface-1" } }] })).toThrow("operations");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ dataModelUpdate: { surfaceId: "surface-1", contents: [{ key: "apiToken", valueString: "forbidden" }] } }] })).toThrow("operations");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }], proof: "forbidden" })).toThrow("envelope");
		expect(() => ___ParseAgUiA2uiEnvelope({ ...base, operations: [{ beginRendering: { surfaceId: "surface-1", root: "root-1" } }], reason: "unsafe\u0000reason" })).toThrow("reason");
	});
});
