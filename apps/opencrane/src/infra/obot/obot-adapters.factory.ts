import { __CreateHttpObotCustodyAdapter, __CreateHttpObotMcpInvocationAdapter, __CreateObotSession, __UnavailableObotCustodyAdapter, __UnavailableObotMcpInvocationAdapter } from "@opencrane/backend/server/infra/obot-custody";

import type { OpenCraneObotConfig } from "../../app/config.types.js";
import type { ObotAdapters } from "./obot-adapters.factory.types.js";

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
	if (config === null) return { custody: new __UnavailableObotCustodyAdapter(), invocation: new __UnavailableObotMcpInvocationAdapter() };
	const session = __CreateObotSession({ baseUrl: config.gatewayUrl, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, serviceTokenFile: config.serviceTokenPath });
	return { custody: __CreateHttpObotCustodyAdapter(session), invocation: __CreateHttpObotMcpInvocationAdapter(session) };
}
