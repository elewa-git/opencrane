import { __CreateHttpObotCustodyAdapter, __CreateHttpObotMcpInvocationAdapter, __CreateObotSession, __UnavailableObotCustodyAdapter, __UnavailableObotMcpInvocationAdapter } from "@opencrane/backend/server/infra/obot-custody";

import type { OpenCraneObotConfig } from "../../app/config.types";
import type { ObotAdapters } from "./obot-adapters.factory.types";

/**
 * Compose the server-owned Obot custody and MCP invocation authorities from process configuration.
 *
 * With no configuration the fail-closed unavailable custody adapter is returned, so custody
 * provisioning refuses loudly instead of minting a local handle. With configuration, the mounted
 * service credential remains inside the server-owned transport.
 *
 * @param config - Optional Obot block read at startup; null leaves the feature off.
 * @returns Custody and invocation ports backed by one configured server transport.
 */
export function _CreateObotAdapters(config: OpenCraneObotConfig | null): ObotAdapters
{
	if (config === null) return { custody: new __UnavailableObotCustodyAdapter(), invocation: new __UnavailableObotMcpInvocationAdapter(), stop: function _StopUnavailable() {} };
	const shutdown = new AbortController();
	const session = __CreateObotSession({ baseUrl: config.gatewayUrl, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, serviceTokenFile: config.serviceTokenPath, shutdownSignal: shutdown.signal });
	return { custody: __CreateHttpObotCustodyAdapter(session), invocation: __CreateHttpObotMcpInvocationAdapter(session), stop: function _StopObot() { shutdown.abort(); } };
}
