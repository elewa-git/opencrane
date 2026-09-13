import { type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MCP_PROTOCOL_VERSION, ___BuildMcpDiscoveryRequest, ___BuildMcpToolCallRequest, ___BuildMcpToolsListRequest, ___ConversationModelToolCallSchema, ___ParseMcpDiscoveryResponse, ___ParseMcpToolCallResponse, ___ParseMcpToolsListResponse } from "@opencrane/contracts";
import { GENERATED_CSV_TOOL_NAME } from "@opencrane/models/conversation-assets";

import { __CreateMcpFileGeneratorServer } from "../mcp-file-generator-http";
import { MCP_FILE_GENERATOR_HOST, MCP_FILE_GENERATOR_MAX_REQUEST_BYTES, MCP_FILE_GENERATOR_RESOURCE_URI } from "../../mcp/mcp-file-generator-contract";

/** Server shared by the loopback HTTP contract tests. */
let _server: Server;
/** Ephemeral loopback URL assigned by Node for the tests. */
let _url: string;

beforeAll(async function _StartServer()
{
	const log = { error: vi.fn() } as never;
	_server = __CreateMcpFileGeneratorServer(log);
	await new Promise<void>(function _Listen(resolve, reject)
	{
		_server.once("error", reject);
		_server.listen(0, MCP_FILE_GENERATOR_HOST, function _Listening()
		{
			_server.off("error", reject);
			resolve();
		});
	});
	const address = _server.address() as AddressInfo;
	_url = `http://${MCP_FILE_GENERATOR_HOST}:${address.port}/mcp`;
});

afterAll(async function _StopServer()
{
	await new Promise<void>(function _Close(resolve, reject)
	{
		_server.close(function _Closed(error)
		{
			if (error)
				reject(error);
			else
				resolve();
		});
		_server.closeAllConnections();
	});
});

describe("MCP file generator HTTP server", function _McpHttpSuite()
{
	it("serves discovery and the immutable CSV tool through the shared protocol parsers", async function _DiscoversTool()
	{
		const discovery = ___ParseMcpDiscoveryResponse(await _Post(___BuildMcpDiscoveryRequest()));
		expect(discovery.supportedVersions).toContain(MCP_PROTOCOL_VERSION);

		const listed = ___ParseMcpToolsListResponse(await _Post(___BuildMcpToolsListRequest()));
		expect(listed).toMatchObject({ nextCursor: null, tools: [{ name: GENERATED_CSV_TOOL_NAME }] });
		expect(___ConversationModelToolCallSchema.safeParse({ id: "generated-file-call", name: GENERATED_CSV_TOOL_NAME, arguments: "{}", content: null }).success).toBe(true);
	});

	it("returns one embedded UTF-8 CSV resource and no mixed content", async function _CallsTool()
	{
		const request = ___BuildMcpToolCallRequest("invocation-1", GENERATED_CSV_TOOL_NAME, { displayName: "customers.csv", headers: ["Name", "Balance"], rows: [["Amina", -12.5]] });
		const result = ___ParseMcpToolCallResponse(await _Post(request), "invocation-1");

		expect(result).toEqual({ isError: false, content: [{ type: "resource", resource: { uri: MCP_FILE_GENERATOR_RESOURCE_URI, mimeType: "text/csv;charset=utf-8", text: "Name,Balance\r\nAmina,-12.5\r\n" } }] });
	});

	it("returns a content-free stable error for rejected arguments", async function _RejectsArguments()
	{
		const secret = "=HYPERLINK(\"https://secret.example\")";
		const request = ___BuildMcpToolCallRequest("invocation-2", GENERATED_CSV_TOOL_NAME, { displayName: "customers.csv", headers: ["Name"], rows: [[secret]] });
		const response = await _PostResponse(request);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(body).toContain('"message":"invalid_arguments"');
		expect(body).not.toContain(secret);
	});

	it("refuses declared requests above one MiB before JSON parsing", async function _RejectsLargeRequest()
	{
		const response = await fetch(_url, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(MCP_FILE_GENERATOR_MAX_REQUEST_BYTES + 1) });
		const body = await response.text();

		expect(response.status).toBe(413);
		expect(body).toContain('"message":"parse_error"');
		expect(body).not.toContain("xxxx");
	});

	it("rejects routes and media types outside the fixed MCP endpoint", async function _RejectsWrongHttpShape()
	{
		const wrongRoute = await fetch(_url.replace(/\/mcp$/u, "/other"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
		const wrongMedia = await fetch(_url, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });

		expect(wrongRoute.status).toBe(404);
		expect(wrongMedia.status).toBe(415);
	});
});

/** Posts one request and returns its parsed JSON body. */
async function _Post(value: unknown): Promise<unknown>
{
	return (await _PostResponse(value)).json();
}

/** Posts one request to the ephemeral loopback server. */
function _PostResponse(value: unknown): Promise<Response>
{
	return fetch(_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
}
