import { isAbsolute } from "node:path";

import { ByokProvider } from "@opencrane/contracts";
import { FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";

import type { InitialModelBootstrapConfig, OpenCraneObotConfig, OpenCraneProcessConfig } from "./config.types.js";
import type { StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";

/** Smallest accepted artifact-preprocessor output body. */
const _MINIMUM_ARTIFACT_OUTPUT_BYTES = 1_024;

/** Largest accepted artifact-preprocessor output body. */
const _MAXIMUM_ARTIFACT_OUTPUT_BYTES = 64 * 1_024 * 1_024;

/** Default artifact-preprocessor output body limit. */
const _DEFAULT_ARTIFACT_OUTPUT_BYTES = 16 * 1_024 * 1_024;

/** Read one bounded whole-number setting from the startup environment. */
function _readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
	{
		throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	}
	return value;
}

/** Read one bounded seconds setting and expose milliseconds to runtime composition. */
function _readBoundedSeconds(name: string, fallbackSeconds: number, minimumSeconds: number, maximumSeconds: number): number
{
	return _readBoundedInteger(name, fallbackSeconds, minimumSeconds, maximumSeconds) * 1_000;
}

/** Require one non-empty setting so a missing chart value fails boot instead of composing a dead client. */
function _readRequired(name: string): string
{
	const value = process.env[name]?.trim() ?? "";
	if (value.length === 0) throw new Error(`${name} is required`);
	return value;
}

/** Require one absolute mounted-file path for the projected memory-gateway caller token. */
function _readRequiredAbsolutePath(name: string): string
{
	const value = _readRequired(name);
	if (!value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
	return value;
}

/** Read the bounded output ceiling shared with the server-side promotion broker. */
function _readArtifactPreprocessorBodyLimit(): number
{
	const raw = process.env.ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES?.trim() ?? String(_DEFAULT_ARTIFACT_OUTPUT_BYTES);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < _MINIMUM_ARTIFACT_OUTPUT_BYTES || value > _MAXIMUM_ARTIFACT_OUTPUT_BYTES)
	{
		throw new Error(`ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES must be an integer from ${_MINIMUM_ARTIFACT_OUTPUT_BYTES} through ${_MAXIMUM_ARTIFACT_OUTPUT_BYTES}`);
	}
	return value;
}

/**
 * Read the optional initial provider credential injected only by the silo deployment contract.
 * The pair is all-or-nothing so an operator cannot accidentally start with a provider name but no
 * key (or expose a key without a declared LiteLLM provider).
 */
function _readInitialModelBootstrap(): InitialModelBootstrapConfig | null
{
	const provider = process.env.OPENCRANE_INITIAL_MODEL_PROVIDER?.trim().toLowerCase() ?? "";
	const apiKey = process.env.OPENCRANE_INITIAL_MODEL_API_KEY?.trim() ?? "";
	if (!provider && !apiKey)
	{
		return null;
	}
	if (!provider || !apiKey)
	{
		throw new Error("OPENCRANE_INITIAL_MODEL_PROVIDER and OPENCRANE_INITIAL_MODEL_API_KEY must be configured together");
	}
	if (!Object.values(ByokProvider).includes(provider as ByokProvider))
	{
		throw new Error(`OPENCRANE_INITIAL_MODEL_PROVIDER '${provider}' is unsupported`);
	}
	return { provider, apiKey };
}

/** Read the all-or-nothing verified-email admission contract for one standalone silo owner. */
function _readStandaloneFirstUserAdmission(): StandaloneFirstUserAdmissionConfig | null
{
	const email = process.env.OPENCRANE_STANDALONE_FIRST_USER_EMAIL?.trim().toLowerCase() ?? "";
	const clusterTenant = process.env.OPENCRANE_STANDALONE_CLUSTER_TENANT?.trim() ?? "";
	const issuer = process.env.OIDC_ISSUER_URL?.trim() ?? "";
	if (!email && !clusterTenant)
	{
		return null;
	}
	if (!email || !clusterTenant)
	{
		throw new Error("OPENCRANE_STANDALONE_FIRST_USER_EMAIL and OPENCRANE_STANDALONE_CLUSTER_TENANT must be configured together");
	}
	if (process.env.OPENCRANE_MEMBERSHIP_MODE !== FleetMembershipDeploymentModes.Standalone)
	{
		throw new Error("standalone first-user admission requires OPENCRANE_MEMBERSHIP_MODE=standalone");
	}
	if (!issuer)
	{
		throw new Error("standalone first-user admission requires OIDC_ISSUER_URL");
	}
	return { email, clusterTenant, issuer };
}

/**
 * Read the optional Obot management-transport block from the startup environment.
 *
 * Both coordinates present composes the authenticated transport; both absent leaves the feature off
 * (fail-closed unavailable adapters). A partial block is a deployment mistake, so startup refuses it
 * rather than half-composing an authority that would fail on first use.
 */
function _readObotConfig(): OpenCraneObotConfig | null
{
	const gatewayUrl = process.env.OBOT_GATEWAY_URL?.trim();
	const serviceTokenPath = process.env.OBOT_SERVICE_TOKEN_PATH?.trim();
	if (!gatewayUrl && !serviceTokenPath) return null;
	if (!gatewayUrl || !serviceTokenPath)
	{
		throw new Error("OBOT_GATEWAY_URL and OBOT_SERVICE_TOKEN_PATH must be configured together or not at all");
	}
	if (!isAbsolute(serviceTokenPath))
	{
		throw new Error("OBOT_SERVICE_TOKEN_PATH must be an absolute mounted file path");
	}
	return { gatewayUrl, serviceTokenPath, requestTimeoutMilliseconds: _readBoundedSeconds("OBOT_TIMEOUT_SECONDS", 30, 1, 300) };
}

/**
 * Read process settings once so listeners and workers share one startup snapshot.
 *
 * Runtime namespace presence and separation remain worker invariants because those values grant
 * Kubernetes cleanup authority; parsing configuration alone must not make that trust decision.
 */
export function _ReadProcessConfig(): OpenCraneProcessConfig
{
	return {
		authWatchNamespace: process.env.WATCH_NAMESPACE ?? process.env.NAMESPACE ?? "default",
		initialModelBootstrap: _readInitialModelBootstrap(),
		internalPort: Number(process.env.INTERNAL_PORT ?? "8081"),
		obot: _readObotConfig(),
		publicPort: Number(process.env.PORT ?? "8080"),
		runtime: {
			artifactPreprocessorEnabled: process.env.ARTIFACT_PREPROCESSOR_ENABLED === "true",
			artifactPreprocessorMaximumOutputBytes: _readArtifactPreprocessorBodyLimit(),
			artifactPreprocessorNamespace: process.env.ARTIFACT_PREPROCESSOR_NAMESPACE?.trim(),
			assignmentTtlMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS", 3_600, 60, 86_400),
			channelReplayRouteId: process.env.CHANNEL_REPLAY_ROUTE_ID?.trim() || null,
			claimLeaseMilliseconds: _readBoundedSeconds("AGENT_CONTROLLER_CLAIM_LEASE_SECONDS", 30, 1, 300),
			commandRecoveryMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_COMMAND_RECOVERY_POLL_SECONDS", 5, 5, 300),
			commandTtlMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_COMMAND_TTL_SECONDS", 60, 1, 300),
			managedRuntimeNamespace: process.env.AGENT_RUNTIME_MANAGED_NAMESPACE?.trim(),
			memoryGatewayTimeoutMilliseconds: _readBoundedSeconds("MEMORY_GATEWAY_TIMEOUT_SECONDS", 30, 1, 300),
			memoryGatewayTokenPath: _readRequiredAbsolutePath("MEMORY_GATEWAY_TOKEN_PATH"),
			memoryGatewayUrl: _readRequired("MEMORY_GATEWAY_URL"),
			outboxPruneBatchSize: _readBoundedInteger("AGENT_RUNTIME_OUTBOX_PRUNE_BATCH_SIZE", 100, 1, 1_000),
			personalRuntimeNamespace: process.env.AGENT_RUNTIME_PERSONAL_NAMESPACE?.trim(),
			publishedOutboxRetentionMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_OUTBOX_RETENTION_SECONDS", 604_800, 3_600, 7_776_000),
			serverNamespace: process.env.POD_NAMESPACE?.trim() || "default",
		},
		schedulerEnabled: process.env.OPENCRANE_SCHEDULER_ENABLED === "true",
		schedulerIntervalMilliseconds: _readBoundedInteger("OPENCRANE_SCHEDULER_INTERVAL_MS", 60_000, 1_000, 3_600_000),
		standaloneFirstUserAdmission: _readStandaloneFirstUserAdmission(),
	};
}
