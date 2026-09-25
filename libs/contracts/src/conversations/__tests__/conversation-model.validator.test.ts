import { describe, expect, it } from "vitest";

import { ConversationModelResponseKinds, type ConversationModelToolCall } from "../conversation-model.types";
import { ___ConversationModelResponseSchema, ___ConversationModelToolCallSchema, ___ConversationModelToolExchangeSchema, ___ConversationModelToolHistorySchema } from "../conversation-model.validator";

/** Supplies a saved declaration whose original argument formatting matters on replay. */
function _call(overrides: Partial<ConversationModelToolCall> = {}): ConversationModelToolCall
{
	return { id: "call_saved-1", name: "read_file", arguments: '{ "path" : "notes.txt" }', content: null, ...overrides };
}

describe("conversation model saved content", function _schemas()
{
	it("preserves the original declaration strings and creates a detached object", function _exactCall()
	{
		const call = _call({ content: "  Let me check.\n" });
		const parsed = ___ConversationModelToolCallSchema.parse(call);
		expect(parsed).toEqual(call);
		expect(parsed).not.toBe(call);
	});

	it.each([
		{ id: "" }, { id: "call with spaces" }, { name: "read.file" }, { name: "x".repeat(65) },
		{ arguments: "[]" }, { arguments: "null" }, { arguments: "1" }, { arguments: "{" },
		{ arguments: '{"value": 1e999}' }, { arguments: '{"value":"\\ud800"}' },
		{ arguments: " ".repeat(65_537) }, { content: "\ud800" }, { extra: "hidden" },
	])("rejects malformed declaration %#", function _invalidCall(change)
	{
		expect(___ConversationModelToolCallSchema.safeParse({ ..._call(), ...change }).success).toBe(false);
	});

	it("rejects excessive argument nesting without recursively walking an unbounded tree", function _deepArguments()
	{
		const argumentsText = '{"next":'.repeat(18) + '{}' + '}'.repeat(18);
		expect(___ConversationModelToolCallSchema.safeParse(_call({ arguments: argumentsText })).success).toBe(false);
	});

	it("rejects excessive argument nodes inside the byte ceiling", function _wideArguments()
	{
		const argumentsText = JSON.stringify({ values: new Array(8_193).fill(0) });
		expect(argumentsText.length).toBeLessThan(65_536);
		expect(___ConversationModelToolCallSchema.safeParse(_call({ arguments: argumentsText })).success).toBe(false);
	});

	it("bounds the entire serialized declaration rather than each string independently", function _declarationBytes()
	{
		expect(___ConversationModelToolCallSchema.safeParse(_call({ arguments: JSON.stringify({ value: "a".repeat(34_000) }), content: "b".repeat(34_000) })).success).toBe(false);
	});

	it("preserves paired content and rejects combined overflow, bad Unicode and extra fields", function _continuation()
	{
		const exchange = { call: _call(), resultContent: '{"result":"It is ready."}' };
		expect(___ConversationModelToolExchangeSchema.parse(exchange)).toEqual(exchange);
		for (const changed of [
			{ ...exchange, resultContent: "" }, { ...exchange, resultContent: "\ud800" },
			{ ...exchange, call: _call({ content: "x".repeat(35_000) }), resultContent: "y".repeat(35_000) },
			{ ...exchange, tool_call_id: "different" },
		])
			expect(___ConversationModelToolExchangeSchema.safeParse(changed).success).toBe(false);
	});

	it("accepts the combined serialized custody ceiling exactly", function _custodyBoundary()
	{
		const value = { call: _call(), resultContent: "x" };
		const overhead = new TextEncoder().encode(JSON.stringify(value)).byteLength - 1;
		value.resultContent = "x".repeat(65_536 - overhead);
		expect(___ConversationModelToolExchangeSchema.safeParse(value).success).toBe(true);
		expect(___ConversationModelToolExchangeSchema.safeParse({ ...value, resultContent: value.resultContent + "x" }).success).toBe(false);
	});

	it("accepts Select history in order and rejects duplicate provider call ids", function _History()
	{
		const history = [{ call: _call({ id: "first" }), resultContent: "first result" }, { call: _call({ id: "second" }), resultContent: "second result" }];
		expect(___ConversationModelToolHistorySchema.parse(history)).toEqual(history);
		expect(___ConversationModelToolHistorySchema.safeParse([...history, { ...history[0]! }]).success).toBe(false);
	});

	it("rejects a history that exceeds its ordered entry bound", function _HistoryBytes()
	{
		const history = new Array(129).fill(null).map(function _Exchange(_value, index) { return { call: _call({ id: `call-${index}` }), resultContent: "result" }; });
		expect(___ConversationModelToolHistorySchema.safeParse(history).success).toBe(false);
	});

	it.each([
		{ kind: "other", text: "answer" }, { kind: ConversationModelResponseKinds.Text, text: " " },
		{ kind: ConversationModelResponseKinds.Text, text: "\ud800" },
		{ kind: ConversationModelResponseKinds.Text, text: "é".repeat(32_769) },
		{ kind: ConversationModelResponseKinds.Text, text: "answer", call: _call() },
		{ kind: ConversationModelResponseKinds.Tool, call: _call(), text: "answer" },
	])("rejects unknown or contradictory shared response %#", function _responseShape(value)
	{
		expect(___ConversationModelResponseSchema.safeParse(value).success).toBe(false);
	});
});
