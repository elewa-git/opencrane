import type { AgentControllerProcessConfig } from "./config.types.js";

/** Read closed controller configuration; each missing or widened boundary fails startup. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): AgentControllerProcessConfig
{
	const runtimeNamespace = environment["AGENT_CONTROLLER_WORKLOAD_NAMESPACE"]?.trim() ?? "";
	const runtimeServiceAccountName = environment["AGENT_RUNTIME_SERVICE_ACCOUNT"]?.trim() ?? "";
	const runtimeImage = environment["AGENT_RUNTIME_IMAGE"]?.trim() ?? "";
	const runtimeProjectedTokenTtlSeconds = _positive(environment["AGENT_RUNTIME_PROJECTED_TOKEN_TTL_SECONDS"], 600);
	const runtimeAppName = environment["AGENT_RUNTIME_APP_NAME"]?.trim() ?? "";
	const runtimeReleaseInstance = environment["AGENT_RUNTIME_RELEASE_INSTANCE"]?.trim() ?? "";
	const openCraneInternalUrl = environment["OPENCRANE_INTERNAL_URL"]?.trim() ?? "";
	const openCraneTokenPath = environment["AGENT_CONTROLLER_OPENCRANE_TOKEN_PATH"]?.trim() ?? "";
	const kubernetesTokenPath = environment["AGENT_CONTROLLER_KUBERNETES_TOKEN_PATH"]?.trim() ?? "";
	const kubernetesCaPath = environment["AGENT_CONTROLLER_KUBERNETES_CA_PATH"]?.trim() ?? "";
	if (!_dnsLabel(runtimeNamespace) || !_dnsLabel(runtimeServiceAccountName) || !_labelValue(runtimeAppName) || !_labelValue(runtimeReleaseInstance) || !/^.+@sha256:[a-f0-9]{64}$/u.test(runtimeImage) || !_internalUrl(openCraneInternalUrl) || !_absolutePath(openCraneTokenPath) || !_absolutePath(kubernetesTokenPath) || !_absolutePath(kubernetesCaPath)) throw new Error("agent controller configuration is incomplete or unsafe");
	return { runtimeNamespace, runtimeServiceAccountName, runtimeImage, runtimeProjectedTokenTtlSeconds, runtimePodLabels: { "app.kubernetes.io/name": runtimeAppName, "app.kubernetes.io/instance": runtimeReleaseInstance }, openCraneInternalUrl, openCraneTokenPath, kubernetesTokenPath, kubernetesCaPath, pollIntervalMs: _positive(environment["AGENT_CONTROLLER_POLL_INTERVAL_MS"], 1_000), healthPort: _port(environment["AGENT_CONTROLLER_HEALTH_PORT"], 8_080) };
}

/** Checks a conservative Kubernetes DNS-label boundary. */
function _dnsLabel(value: string): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) && value.length <= 63;
}

/** Checks one bounded Kubernetes label value emitted into the runtime Pod selector. */
function _labelValue(value: string): boolean
{
	return /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(value) && value.length <= 63;
}

/** Allows only a credential-free in-cluster server authority URL. */
function _internalUrl(value: string): boolean
{
	try { const parsed = new URL(value); return parsed.protocol === "http:" && parsed.username.length === 0 && parsed.password.length === 0 && parsed.hostname.endsWith(".svc.cluster.local") && parsed.pathname === "/"; }
	catch { return false; }
}

/** Requires an absolute mounted token or CA path. */
function _absolutePath(value: string): boolean
{
	return value.startsWith("/");
}

/** Parses a positive bounded loop interval. */
function _positive(value: string | undefined, fallback: number): number
{
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) throw new Error("AGENT_CONTROLLER_POLL_INTERVAL_MS must be between 100 and 60000");
	return parsed;
}

/** Parses a valid local TCP listener port without allowing an accidental privileged bind. */
function _port(value: string | undefined, fallback: number): number
{
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1_024 || parsed > 65_535) throw new Error("AGENT_CONTROLLER_HEALTH_PORT must be between 1024 and 65535");
	return parsed;
}
