import type { ChannelProxyConfig } from "@opencrane/backend/channel-proxy";

/** Fully validated channel-proxy process configuration. */
export interface ChannelProxyProcessConfig
{
	/** Public HTTP listener port. */
	port: number;
	/** Internal OpenCrane authority URL. */
	openCraneUrl: string;
	/** OpenCrane resolver timeout in milliseconds. */
	resolverTimeoutMs: number;
	/** Per-subject requests admitted per rate-limit window. */
	rateLimit: number;
	/** Rate-limit window in milliseconds. */
	rateWindowMs: number;
	/** Core proxy policy and transport bounds. */
	proxy: ChannelProxyConfig;
}
