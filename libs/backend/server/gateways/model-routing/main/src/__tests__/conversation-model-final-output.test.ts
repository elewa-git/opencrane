import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompiledFinalOutputModes, CONVERSATION_A2UI_SURFACE_PLACEHOLDER, ConversationModelResponseKinds, ConversationModelToolModes, type ConversationModelRequest } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __RequestConversationModel } from "../core/conversation-model";
import { ConversationModelFailureCodes } from "../core/conversation-model.types";
import { _RETRY_NOW, _RetryRequest } from "./conversation-model-retry.fixture";

/** Keeps real timers, globals and mocks isolated across transport cases. */
afterEach(function _Restore() { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
/** Fixes the frozen request deadline without making any network calls. */
beforeEach(function _Clock() { vi.useFakeTimers(); vi.setSystemTime(_RETRY_NOW); });

/** Supplies the explicit compiled format rather than inferring it from response content. */
function _request(mode = CompiledFinalOutputModes.Conversation): ConversationModelRequest
{
	const request = _RetryRequest();
	return { ...request, compiledInput: { ...request.compiledInput, finalOutput: mode } };
}

/** Wraps final content in the supported provider envelope without metadata authority. */
function _response(content: string): Response
{
	return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { ignored: true } }), { headers: { "content-type": "application/json" } });
}

/** Uses one complete official static display alongside its ordinary answer. */
function _answer()
{
	return { text: "  Saved answer 👩🏽‍💻\n", display: [
		{ surfaceUpdate: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, components: [{ id: "root", component: { Text: { text: { literalString: "Ready" } } } }] } },
		{ beginRendering: { surfaceId: CONVERSATION_A2UI_SURFACE_PLACEHOLDER, root: "root" } },
	] };
}

describe("explicit final output format", function _Suite()
{
	it("decodes conversation text and its display while omitting provider metadata", async function _Structured()
	{
		const answer = _answer();
		const fetch = vi.fn().mockResolvedValue(_response(JSON.stringify(answer)));
		vi.stubGlobal("fetch", fetch);
		expect(await __RequestConversationModel(_request())).toEqual({ kind: ConversationModelResponseKinds.Text, ...answer });
		expect(fetch).toHaveBeenCalledOnce();
		expect(JSON.parse(String(fetch.mock.calls[0][1].body))).not.toHaveProperty("response_format");
	});

	it("accepts ordinary envelope text without synthesizing a display", async function _Ordinary()
	{
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_response('{"text":"  Answer\\n"}')));
		expect(await __RequestConversationModel(_request())).toEqual({ kind: ConversationModelResponseKinds.Text, text: "  Answer\n" });
	});

	it("preserves JSON-looking literal text when the frozen mode is Text", async function _LiteralJson()
	{
		const text = `  ${JSON.stringify(_answer())}\n`;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(_response(text)));
		expect(await __RequestConversationModel(_request(CompiledFinalOutputModes.Text))).toEqual({ kind: ConversationModelResponseKinds.Text, text });
	});

	it.each(["plain text is not an envelope", '```json\n{"text":"ok"}\n```', '{"text":" "}', '{"text":"\\ud800"}', '{"text":"private-value","execute":"private-command"}', '{"text":"ok","display":null}', '{"text":"ok","display":[]}'])("rejects malformed final content without retaining raw diagnostics", async function _Malformed(content)
	{
		const fetch = vi.fn().mockResolvedValue(_response(content));
		vi.stubGlobal("fetch", fetch);
		const error = await __RequestConversationModel(_request()).catch(function _Failure(failure: unknown) { return failure; });
		expect(error).toMatchObject({ code: ConversationModelFailureCodes.UnsupportedResponse, message: "Conversation model request failed: unsupported_response" });
		expect(error).not.toHaveProperty("cause");
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([undefined, "unsupported"])("refuses absent or unknown frozen modes before dispatch", async function _MissingMode(finalOutput)
	{
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const request = _request();
		await expect(__RequestConversationModel({ ...request, compiledInput: { ...request.compiledInput, finalOutput: finalOutput as never } })).rejects.toMatchObject({ code: ConversationModelFailureCodes.InvalidRequest });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("captures the mode before dispatch so a caller cannot reinterpret the in-flight response", async function _CapturedMode()
	{
		const request = _request();
		vi.stubGlobal("fetch", vi.fn(async function _MutatesCaller()
		{
			Object.assign(request.compiledInput, { finalOutput: CompiledFinalOutputModes.Text });
			return _response(JSON.stringify({ text: "accepted envelope" }));
		}));
		expect(await __RequestConversationModel(request)).toEqual({ kind: ConversationModelResponseKinds.Text, text: "accepted envelope" });
	});

	it("keeps tool declarations unchanged in Conversation mode", async function _ToolProtocol()
	{
		const request = _request();
		const parametersSchema = { type: "object", additionalProperties: false };
		const tool = { name: "records.lookup", modelName: "lookup", toolRevisionId: "tool-revision", description: "Look up records", requiresApproval: false, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
		const call = { id: "call_lookup", name: "lookup", arguments: "  {} ", content: "Looking up records" };
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: call.content, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] } }] }), { headers: { "content-type": "application/json" } })));
		expect(await __RequestConversationModel({ ...request, tools: ConversationModelToolModes.Select, compiledInput: { ...request.compiledInput, tools: [tool] } })).toEqual({ kind: ConversationModelResponseKinds.Tool, call });
	});
});
