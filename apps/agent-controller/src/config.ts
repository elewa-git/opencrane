import type { AgentControllerProcessConfig } from "./config.types.js";

/** Read closed controller configuration; each missing or widened boundary fails startup. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): AgentControllerProcessConfig
{
	const runtimeNamespace = environment["AGENT_CONTROLLER_WORKLOAD_NAMESPACE"]?.trim() ?? "";
	const runtimeServiceAccountName = environment["AGENT_RUNTIME_SERVICE_ACCOUNT"]?.trim() ?? "";
	const runtimeImage = environment["AGENT_RUNTIME_IMAGE"]?.trim() ?? "";
	const openCraneInternalUrl = environment["OPENCRANE_INTERNAL_URL"]?.trim() ?? "";
	const openCraneTokenPath = environment["AGENT_CONTROLLER_OPENCRANE_TOKEN_PATH"]?.trim() ?? "";
	const kubernetesTokenPath = environment["AGENT_CONTROLLER_KUBERNETES_TOKEN_PATH"]?.trim() ?? "";
	const kubernetesCaPath = environment["AGENT_CONTROLLER_KUBERNETES_CA_PATH"]?.trim() ?? "";
	if (!_dnsLabel(runtimeNamespace) || !_dnsLabel(runtimeServiceAccountName) || !/^.+@sha256:[a-f0-9]{64}$/u.test(runtimeImage) || !_internalUrl(openCraneInternalUrl) || !_absolutePath(openCraneTokenPath) || !_absolutePath(kubernetesTokenPath) || !_absolutePath(kubernetesCaPath)) throw new Error("agent controller configuration is incomplete or unsafe");
	return { runtimeNamespace, runtimeServiceAccountName, runtimeImage, openCraneInternalUrl, openCraneTokenPath, kubernetesTokenPath, kubernetesCaPath, pollIntervalMs: _positive(environment["AGENT_CONTROLLER_POLL_INTERVAL_MS"], 1_000) };
}

/** Checks a conservative Kubernetes DNS-label boundary. */
function _dnsLabel(value: string): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) && value.length <= 63;
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
