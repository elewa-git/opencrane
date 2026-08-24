import { lookup } from "node:dns/promises";

import { ___DoWithoutTrace, ___DoWithTrace } from "@opencrane/backend/observability";

import { _McpEraProbeEndpoint, _McpEraProbeIsPublicAddress } from "./mcp-era-probe-address-policy";
import { McpEraProbeConfigurationError, McpEraProbeTransportError } from "./mcp-era-probe.errors";
import { _McpEraProbeHttpsRequest, _McpEraProbeTransportFailure, _McpEraProbeWithDeadline } from "./mcp-era-probe-https";
import { _McpEraProbeDiscoveryRequest, _McpEraProbeDiscoveryResult } from "./mcp-era-probe-protocol";
import type { McpEraProbeClient, McpEraProbeDnsAddress, McpEraProbeDnsResolver, McpEraProbeHttpsClientOptions, McpEraProbeHttpsRequest, McpEraProbeHttpsResponse, McpEraProbeResult } from "./mcp-era-probe.types";

/**
 * Create the HTTPS MCP protocol-check adapter.
 *
 * Every call validates every DNS result, binds the TLS socket to one reviewed address, rejects
 * redirects, and sends only `server/discover`. The adapter never initializes a session, tries an
 * older protocol revision, or contacts Obot.
 *
 * Called by: OpenCrane application composition, which supplies the protocol revision owned by the
 * MCP domain.
 *
 * @param options - Protocol revision, timeout, response limit, and optional deterministic seams.
 * @returns An external transport client with no registration or approval authority.
 * @throws McpEraProbeConfigurationError When its options are invalid.
 * @see https://modelcontextprotocol.io/specification/2026-07-28
 */
export function __CreateHttpsMcpEraProbeClient(options: McpEraProbeHttpsClientOptions): McpEraProbeClient
{
	if (options.protocolVersion.trim().length === 0 || options.protocolVersion.length > 64 || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000 || !Number.isSafeInteger(options.maximumResponseBytes) || options.maximumResponseBytes < 1 || options.maximumResponseBytes > 1_048_576) throw new McpEraProbeConfigurationError("invalid_endpoint");
	const resolve: McpEraProbeDnsResolver = options.resolve ?? async function _Resolve(hostname): Promise<readonly McpEraProbeDnsAddress[]>
	{
		const records = await lookup(hostname, { all: true, verbatim: true });
		if (records.some(function _UnknownFamily(record) { return record.family !== 4 && record.family !== 6; })) throw new McpEraProbeConfigurationError("unsafe_address");
		return records.map(function _Record(record): McpEraProbeDnsAddress { return { address: record.address, family: record.family as 4 | 6 }; });
	};
	const request: McpEraProbeHttpsRequest = options.request ?? _McpEraProbeHttpsRequest;

	return {
		async probe(command): Promise<McpEraProbeResult>
		{
			const endpoint = _McpEraProbeEndpoint(command.endpoint);
			return _McpEraProbeWithDeadline(options.requestTimeoutMilliseconds, async function _ProbeBeforeDeadline(signal): Promise<McpEraProbeResult>
			{
				return await ___DoWithTrace("mcp.era_probe", { protocolVersion: options.protocolVersion }, async function _Probe(): Promise<McpEraProbeResult>
				{
					let addresses: readonly McpEraProbeDnsAddress[];
					try { addresses = await resolve(endpoint.hostname); }
					catch (error) { return _McpEraProbeTransportFailure(error); }
					if (addresses.length === 0 || addresses.some(function _UnsafeAddress(address) { return !_McpEraProbeIsPublicAddress(address); })) throw new McpEraProbeConfigurationError("unsafe_address");

					let response: McpEraProbeHttpsResponse;
					try
					{
						response = await ___DoWithoutTrace(function _RequestWithoutUrlTrace(): Promise<McpEraProbeHttpsResponse>
						{
							return request({ endpoint, resolvedAddress: addresses[0] as McpEraProbeDnsAddress, body: _McpEraProbeDiscoveryRequest(), headers: { accept: "application/json", "content-type": "application/json", "MCP-Protocol-Version": options.protocolVersion }, timeoutMilliseconds: options.requestTimeoutMilliseconds, maximumResponseBytes: options.maximumResponseBytes, signal });
						});
					}
					catch (error) { return _McpEraProbeTransportFailure(error); }
					if (response.status >= 300 && response.status < 400) return _McpEraProbeTransportFailure(new McpEraProbeTransportError("redirect"));
					if (response.status < 200 || response.status >= 300) return _McpEraProbeTransportFailure(new McpEraProbeTransportError(`http_${response.status}`));
					if (response.body.byteLength > options.maximumResponseBytes) return _McpEraProbeTransportFailure(new McpEraProbeTransportError("oversize"));
					return _McpEraProbeDiscoveryResult(response.body);
				});
			});
		},
	};
}
