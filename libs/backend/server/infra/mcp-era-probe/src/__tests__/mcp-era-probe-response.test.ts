import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { _ReadMcpEraProbeResponse } from "../mcp-era-probe-response";

/** A response stream with no socket connection, used to control individual arriving bytes. */
function _response(contentType = "text/event-stream"): IncomingMessage
{
	const response = new IncomingMessage(new Socket());
	response.headers["content-type"] = contentType;
	return response;
}

/** Literal MCP reply independent of the production request and response builders. */
const _REPLY = '{"jsonrpc":"2.0","id":"opencrane-mcp-era-probe","result":{"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{},"ttlMs":3600000,"cacheScope":"public"}}';

describe("MCP probe response acquisition", function _describeResponse()
{
	it("skips progress and closes a stream after its matching result without waiting for EOF", async function _closeAfterResult()
	{
		const response = _response();
		const read = _ReadMcpEraProbeResponse(response, 1_024);
		response.push(Buffer.from('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"probe","progress":1}}\r\n\r\n'));
		response.push(Buffer.from(`data: ${_REPLY}\r`));
		response.push(Buffer.from("\n\r\n"));

		const bytes = await read;
		expect(Buffer.from(bytes).toString()).toContain(_REPLY);
		expect(response.destroyed).toBe(true);
	});

	it("accepts bounded JSON only after the complete body arrives", async function _readJson()
	{
		const response = _response("application/json; charset=utf-8");
		const read = _ReadMcpEraProbeResponse(response, 1_024);
		response.push(Buffer.from(_REPLY.slice(0, 12)));
		response.push(Buffer.from(_REPLY.slice(12)));
		response.push(null);

		expect(Buffer.from(await read).toString()).toBe(_REPLY);
	});

	it("rejects actual and declared oversized bodies and releases each connection", async function _boundBytes()
	{
		const declared = _response();
		declared.headers["content-length"] = "1025";
		await expect(_ReadMcpEraProbeResponse(declared, 1_024)).rejects.toMatchObject({ code: "oversize" });
		const streamed = _response();
		const read = _ReadMcpEraProbeResponse(streamed, 1_024);
		streamed.push(Buffer.alloc(1_025, 32));
		await expect(read).rejects.toMatchObject({ code: "oversize" });
		expect(declared.destroyed).toBe(true);
		expect(streamed.destroyed).toBe(true);
	});

	it.each(["wrong-id", "no-result", "server-request"])("rejects %s without accepting notification data as evidence", async function _rejectInvalidReply(scenario)
	{
		const response = _response();
		const read = _ReadMcpEraProbeResponse(response, 1_024);
		if (scenario === "wrong-id")
			response.push(Buffer.from(`data: ${_REPLY.replace("opencrane-mcp-era-probe", "unrelated")}\n\n`));
		if (scenario === "server-request")
			response.push(Buffer.from('data: {"jsonrpc":"2.0","id":"request","method":"sampling/createMessage","params":{}}\n\n'));
		response.push(null);
		await expect(read).rejects.toMatchObject({ code: "malformed_discovery" });
		expect(response.destroyed).toBe(true);
	});

	it("rejects a connection closed before the terminal response", async function _rejectAborted()
	{
		const response = _response();
		const read = _ReadMcpEraProbeResponse(response, 1_024);
		response.destroy();
		await expect(read).rejects.toMatchObject({ code: "network" });
	});
});
