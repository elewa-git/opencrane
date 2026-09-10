import { ___ParseMcpDiscoveryResponse, McpResponseDecoder } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { McpEraProbeResult } from "./mcp-era-probe.types";
import { McpEraProbeProtocolError } from "./mcp-era-probe.errors";

/** Matches this probe's discovery response without treating notifications as results. */
export const _MCP_ERA_PROBE_REQUEST_ID = "opencrane-mcp-era-probe";

/** Keep the server's validated discovery evidence even when it announces a different revision. */
export function _McpEraProbeDiscoveryResult(body: Uint8Array, contentType: string | undefined, requestedProtocolVersion: string): McpEraProbeResult
{
	try
	{
		const decoder = new McpResponseDecoder(contentType, _MCP_ERA_PROBE_REQUEST_ID, body.byteLength);
		const payload = decoder.push(body) ?? decoder.finish();
		const result = ___ParseMcpDiscoveryResponse(payload, _MCP_ERA_PROBE_REQUEST_ID);
		const protocolVersion = result.supportedVersions.includes(requestedProtocolVersion) ? requestedProtocolVersion : result.supportedVersions[0] as string;
		return { protocolVersion, evidenceDigest: ___DigestCanonicalJson(result) };
	}
	catch { throw new McpEraProbeProtocolError("malformed_discovery"); }
}
