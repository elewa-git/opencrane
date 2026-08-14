import type { MemoryGatewayProcessConfig } from "./config.types";

/** Read and validate the complete private memory-gateway configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): MemoryGatewayProcessConfig
{
	return {
		port: _PositiveInteger(environment.PORT, 8080, "PORT"),
		cogneeUrl: _ClusterHttpOrigin(environment.COGNEE_URL ?? "", "COGNEE_URL"),
		namespace: _RequiredName(environment.POD_NAMESPACE, "POD_NAMESPACE"),
		serverServiceAccountName: _RequiredName(environment.SERVER_SERVICE_ACCOUNT_NAME, "SERVER_SERVICE_ACCOUNT_NAME"),
		serverTokenAudience: _RequiredName(environment.SERVER_TOKEN_AUDIENCE, "SERVER_TOKEN_AUDIENCE"),
		requestTimeoutMilliseconds: _PositiveInteger(environment.REQUEST_TIMEOUT_MS, 30_000, "REQUEST_TIMEOUT_MS"),
	};
}

/** Parse one bounded positive integer with an explicit default. */
function _PositiveInteger(value: string | undefined, fallback: number, name: string): number
{
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300_000)
	{
		throw new Error(`${name} must be an integer from 1 through 300000`);
	}
	return parsed;
}

/** Require a DNS-label-like Kubernetes identifier. */
function _RequiredName(value: string | undefined, name: string): string
{
	const result = value?.trim() ?? "";
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(result))
	{
		throw new Error(`${name} must be a Kubernetes DNS label`);
	}
	return result;
}

/** Accept only the credential-free release-local Cognee Service origin. */
function _ClusterHttpOrigin(value: string, name: string): string
{
	const parsed = new URL(value);
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || !parsed.hostname.endsWith(".svc.cluster.local"))
	{
		throw new Error(`${name} must be an in-cluster HTTP service origin`);
	}
	return parsed.toString();
}
