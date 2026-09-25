import { describe, expect, it } from "vitest";

import { McpProtocolError, McpResponseDecoder } from "../index";

/** Encodes test text as UTF-8 bytes. */
function _Bytes(value: string): Uint8Array
{
	return new TextEncoder().encode(value);
}

describe("MCP response decoder", function _DescribeDecoder()
{
	it("matches a JSON response after fragmented input", function _JsonResponse()
	{
		const decoder = new McpResponseDecoder("Application/JSON; charset=utf-8", "request-1", 1_024);
		expect(decoder.push(_Bytes('{"jsonrpc":"2.0","id":"request-1",'))).toBeUndefined();
		decoder.push(_Bytes('"result":{"ok":true}}'));
		expect(decoder.finish()).toEqual({ jsonrpc: "2.0", id: "request-1", result: { ok: true } });
	});

	it("emits one SSE result after permitted notifications and split CRLF", function _SseResponse()
	{
		const decoder = new McpResponseDecoder("text/event-stream", "request-1", 4_096);
		decoder.push(_Bytes(': keep alive\r'));
		decoder.push(_Bytes('\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r'));
		const result = decoder.push(_Bytes('\ndata: {"jsonrpc":"2.0","id":"request-1","result":{"ok":true}}\r\n\r\n'));
		expect(result).toEqual({ jsonrpc: "2.0", id: "request-1", result: { ok: true } });
		expect(decoder.finish()).toEqual(result);
	});

	it("rejects wrong ids, server requests, and unrequested notifications", function _RejectMessages()
	{
		const wrongId = new McpResponseDecoder("application/json", "request-1", 1_024);
		wrongId.push(_Bytes('{"jsonrpc":"2.0","id":"other","result":{}}'));
		expect(function _FinishWrongId() { wrongId.finish(); }).toThrow(/did not match/u);
		const serverRequest = new McpResponseDecoder("text/event-stream", "request-1", 1_024);
		expect(function _ServerRequest() { serverRequest.push(_Bytes('data: {"jsonrpc":"2.0","id":"server-1","method":"elicitation/create","params":{}}\n\n')); }).toThrow(/did not match/u);
		const notification = new McpResponseDecoder("text/event-stream", "request-1", 1_024);
		expect(function _Notification() { notification.push(_Bytes('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n')); }).toThrow(/not permitted/u);
	});

	it("rejects duplicate responses and trailing input", function _RejectDuplicate()
	{
		const decoder = new McpResponseDecoder("text/event-stream", "request-1", 2_048);
		const response = 'data: {"jsonrpc":"2.0","id":"request-1","result":{}}\n\n';
		expect(decoder.push(_Bytes(response))).toBeDefined();
		expect(function _Duplicate() { decoder.push(_Bytes(response)); }).toThrow(/continued/u);
	});

	it("rejects incomplete, oversized, malformed, and invalid UTF-8 responses", function _RejectFraming()
	{
		const incomplete = new McpResponseDecoder("text/event-stream", "request-1", 1_024);
		incomplete.push(_Bytes('data: {"jsonrpc":"2.0","id":"request-1","result":{}}\n'));
		expect(function _Incomplete() { incomplete.finish(); }).toThrow(/incomplete/u);
		const oversized = new McpResponseDecoder("application/json", "request-1", 4);
		expect(function _Oversized() { oversized.push(_Bytes("12345")); }).toThrow(/byte limit/u);
		const malformed = new McpResponseDecoder("application/json", "request-1", 32);
		malformed.push(_Bytes("{"));
		expect(function _Malformed() { malformed.finish(); }).toThrow(/malformed JSON/u);
		const invalidUtf8 = new McpResponseDecoder("application/json", "request-1", 32);
		invalidUtf8.push(new Uint8Array([0xc3]));
		expect(function _InvalidUtf8() { invalidUtf8.finish(); }).toThrow(/UTF-8/u);
		expect(function _Unsupported() { new McpResponseDecoder("text/plain", "request-1", 32); }).toThrow(McpProtocolError);
	});
});
