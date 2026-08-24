import { ___DigestCanonicalJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import type { McpEraProbeResult } from "./mcp-era-probe.types";
import { McpEraProbeProtocolError } from "./mcp-era-probe.errors";

/** JSON-RPC id used only to match the probe request and response. */
const _JSON_RPC_ID = "opencrane-mcp-era-probe";

/** Build the one JSON-RPC discovery request sent by the probe. */
export function _McpEraProbeDiscoveryRequest(): Uint8Array
{
	return new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: _JSON_RPC_ID, method: "server/discover", params: {} }));
}

/** Validate one discovery response and return only its protocol revision and digest. */
export function _McpEraProbeDiscoveryResult(body: Uint8Array): McpEraProbeResult
{
	let payload: unknown;
	try { payload = JSON.parse(new TextDecoder().decode(body)) as unknown; }
	catch { throw new McpEraProbeProtocolError("malformed_discovery"); }
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new McpEraProbeProtocolError("malformed_discovery");
	const envelope = payload as Record<string, unknown>;
	if (envelope["jsonrpc"] !== "2.0" || envelope["id"] !== _JSON_RPC_ID || Object.hasOwn(envelope, "error") || typeof envelope["result"] !== "object" || envelope["result"] === null || Array.isArray(envelope["result"])) throw new McpEraProbeProtocolError("malformed_discovery");
	const result = envelope["result"] as Record<string, JsonValue>;
	const protocolVersion = result["protocolVersion"];
	if (typeof protocolVersion !== "string" || protocolVersion.trim().length === 0) throw new McpEraProbeProtocolError("malformed_discovery");
	return { protocolVersion, evidenceDigest: ___DigestCanonicalJson(result) };
}
