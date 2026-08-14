import { __CreateHttpCogneeMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import type { InternalRuntimeConfig } from "../../app/config.types";

/**
 * Compose the one authenticated memory-gateway client for this server process.
 *
 * The client presents the projected `opencrane-memory-gateway` audience token on every exchange and
 * validates the release-local gateway origin at construction, so a misconfigured deployment fails
 * boot instead of composing a client that can never authenticate. One instance is shared by
 * admission-time fact selection, compile-time statement loading, and the runtime action transport.
 *
 * @param config - Frozen startup snapshot carrying the gateway origin, token path, and timeout.
 * @returns The process-wide read-only memory-gateway client.
 */
export function _CreateMemoryGatewayClient(config: InternalRuntimeConfig): MemoryGatewayClient
{
	return __CreateHttpCogneeMemoryGatewayClient({ baseUrl: config.memoryGatewayUrl, requestTimeoutMilliseconds: config.memoryGatewayTimeoutMilliseconds, serverTokenFile: config.memoryGatewayTokenPath });
}
