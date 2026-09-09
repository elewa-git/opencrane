import type { McpEraProbeClient as TransportMcpEraProbeClient } from "@opencrane/backend/server/infra/mcp-era-probe";
import type { McpEraProbeClient } from "./mcp-era-probe.types";
import { McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "@opencrane/backend/server/infra/mcp-era-probe";
import { McpEraProbeFailure, McpEraProbeFailureCodes } from "./mcp-era-probe-failure";

/** Translate infrastructure failures into the bounded outcomes owned by the MCP domain. */
export function _McpEraProbeFailure(error: unknown): McpEraProbeFailure
{
	if (error instanceof McpEraProbeConfigurationError)
		return new McpEraProbeFailure(McpEraProbeFailureCodes.UnsafeEndpoint);
	if (error instanceof McpEraProbeProtocolError)
		return new McpEraProbeFailure(McpEraProbeFailureCodes.NotMcpServer);
	if (error instanceof McpEraProbeTransportError)
	{
		const status = error.code.startsWith("http_") ? Number(error.code.slice(5)) : null;
		if (error.code === "network" || error.code === "timeout" || status === 429 || (status !== null && status >= 500))
			return new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable);
		return new McpEraProbeFailure(McpEraProbeFailureCodes.NotMcpServer);
	}
	throw error;
}


/** Converts protocol-probe transport failures into the workflow's retry and denial outcomes. */
export function _CreateMcpEraProbeAdapter(transport: TransportMcpEraProbeClient): McpEraProbeClient
{
	return {
		async probe(request)
		{
			try { return await transport.probe(request); }
			catch (error) { throw _McpEraProbeFailure(error); }
		},
	};
}
