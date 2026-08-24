import { ___DigestCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { McpEraProbeResult } from "./mcp-era-probe.types";
import { McpEraProbeProtocolError } from "./mcp-era-probe.errors";

/** JSON-RPC id used only to match the probe request and response. */
const _JSON_RPC_ID = "opencrane-mcp-era-probe";

/** Build the JSON-RPC discovery request for the protocol revision selected by the MCP domain. */
export function _McpEraProbeDiscoveryRequest(protocolVersion: string): Uint8Array
{
	return new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: _JSON_RPC_ID, method: "server/discover", params: { _meta: { protocolVersion, clientCapabilities: {} } } }));
}

/** Decode a JSON or Server-Sent Events response without retaining its source bytes. */
function _Payload(body: Uint8Array, contentType: string | undefined): unknown
{
	const text = new TextDecoder().decode(body);
	try
	{
		if (contentType?.toLowerCase().startsWith("application/json"))
			return JSON.parse(text) as unknown;
		if (contentType?.toLowerCase().startsWith("text/event-stream"))
		{
			const event = text.split(/\r?\n\r?\n/u).find(function _ResponseEvent(candidate) { return candidate.split(/\r?\n/u).some(function _DataLine(line) { return line.startsWith("data:"); }); });
			if (!event)
				throw new Error("missing SSE data");
			const data = event.split(/\r?\n/u).filter(function _DataLine(line) { return line.startsWith("data:"); }).map(function _DataValue(line) { return line.slice(5).trimStart(); }).join("\n");
			return JSON.parse(data) as unknown;
		}
		throw new Error("unsupported discovery content type");
	}
	catch { throw new McpEraProbeProtocolError("malformed_discovery"); }
}

/** Validate one discovery response and return the best announced revision plus its digest. */
export function _McpEraProbeDiscoveryResult(body: Uint8Array, contentType: string | undefined, requestedProtocolVersion: string): McpEraProbeResult
{
	const payload = _Payload(body, contentType);
	if (typeof payload !== "object" || payload === null || Array.isArray(payload))
		throw new McpEraProbeProtocolError("malformed_discovery");
	const envelope = payload as Record<string, unknown>;
	if (envelope["jsonrpc"] !== "2.0" || envelope["id"] !== _JSON_RPC_ID || Object.hasOwn(envelope, "error") || typeof envelope["result"] !== "object" || envelope["result"] === null || Array.isArray(envelope["result"]))
		throw new McpEraProbeProtocolError("malformed_discovery");
	const result = envelope["result"] as Record<string, JsonValue>;
	const supportedVersions = result["supportedVersions"];
	if (result["resultType"] !== "complete" || !Array.isArray(supportedVersions) || supportedVersions.length === 0 || supportedVersions.some(function _InvalidVersion(version) { return typeof version !== "string" || version.trim().length === 0; }))
		throw new McpEraProbeProtocolError("malformed_discovery");
	const protocolVersion = supportedVersions.includes(requestedProtocolVersion) ? requestedProtocolVersion : supportedVersions[0] as string;
	return { protocolVersion, evidenceDigest: ___DigestCanonicalJson(result) };
}
