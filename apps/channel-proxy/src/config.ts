import type { ChannelProxyProcessConfig } from "./config.types.js";

/** Read and validate the complete process configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): ChannelProxyProcessConfig
{
	const origins = (environment.CHANNEL_PROXY_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
	if (origins.length === 0)
	{
		throw new Error("CHANNEL_PROXY_ALLOWED_ORIGINS must contain at least one exact HTTPS origin");
	}
	for (const origin of origins)
	{
		const parsed = new URL(origin);
		if (parsed.protocol !== "https:" || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
		{
			throw new Error("CHANNEL_PROXY_ALLOWED_ORIGINS accepts exact default-port HTTPS origins only");
		}
	}

	const suffixes = (environment.CHANNEL_PROXY_TARGET_HOST_SUFFIXES ?? ".svc.cluster.local").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
	if (suffixes.length === 0 || suffixes.some(value => !/^\.[a-z0-9.-]+$/.test(value)))
	{
		throw new Error("CHANNEL_PROXY_TARGET_HOST_SUFFIXES must contain internal DNS suffixes beginning with a dot");
	}

	return {
		port: _PositiveInteger(environment.PORT, 8080, "PORT"),
		openCraneUrl: _InternalHttpUrl(environment.OPENCRANE_INTERNAL_URL ?? ""),
		resolverTimeoutMs: _PositiveInteger(environment.CHANNEL_PROXY_RESOLVER_TIMEOUT_MS, 3_000, "CHANNEL_PROXY_RESOLVER_TIMEOUT_MS"),
		rateLimit: _PositiveInteger(environment.CHANNEL_PROXY_RATE_LIMIT, 120, "CHANNEL_PROXY_RATE_LIMIT"),
		rateWindowMs: _PositiveInteger(environment.CHANNEL_PROXY_RATE_WINDOW_MS, 60_000, "CHANNEL_PROXY_RATE_WINDOW_MS"),
		proxy: {
			allowedOrigins: new Set(origins),
			allowedTargetHostSuffixes: suffixes,
			maxCommandBytes: _PositiveInteger(environment.CHANNEL_PROXY_MAX_COMMAND_BYTES, 1_048_576, "CHANNEL_PROXY_MAX_COMMAND_BYTES"),
			maxCommandResponseBytes: _PositiveInteger(environment.CHANNEL_PROXY_MAX_COMMAND_RESPONSE_BYTES, 1_048_576, "CHANNEL_PROXY_MAX_COMMAND_RESPONSE_BYTES"),
			commandTimeoutMs: _PositiveInteger(environment.CHANNEL_PROXY_COMMAND_TIMEOUT_MS, 30_000, "CHANNEL_PROXY_COMMAND_TIMEOUT_MS"),
			streamConnectTimeoutMs: _PositiveInteger(environment.CHANNEL_PROXY_STREAM_CONNECT_TIMEOUT_MS, 5_000, "CHANNEL_PROXY_STREAM_CONNECT_TIMEOUT_MS"),
			streamDurationMs: _PositiveInteger(environment.CHANNEL_PROXY_STREAM_DURATION_MS, 300_000, "CHANNEL_PROXY_STREAM_DURATION_MS"),
			streamIdleTimeoutMs: _PositiveInteger(environment.CHANNEL_PROXY_STREAM_IDLE_TIMEOUT_MS, 45_000, "CHANNEL_PROXY_STREAM_IDLE_TIMEOUT_MS"),
			maxEventBytes: _PositiveInteger(environment.CHANNEL_PROXY_MAX_EVENT_BYTES, 262_144, "CHANNEL_PROXY_MAX_EVENT_BYTES"),
		},
	};
}

/** Parse a positive safe integer or use its explicit default. */
function _PositiveInteger(value: string | undefined, fallback: number, name: string): number
{
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
	{
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

/** Accept only a credential-free in-cluster HTTP authority URL. */
function _InternalHttpUrl(value: string): string
{
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname.endsWith(".svc.cluster.local"))
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be an in-cluster HTTP service URL");
	}
	return parsed.toString();
}
