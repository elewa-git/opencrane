import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";
import { OrganizationMembershipDeploymentModes } from "@opencrane/backend/server/iam/organization-members";

import type { ChannelTargetRuntimeConfig, OpenCraneOrganizationMembershipConfig, OpenCraneProcessConfig, OpenCraneWorkflowConfig } from "./config.types";
import type { StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";

/** Smallest accepted artifact-preprocessor output body. */
const _MINIMUM_ARTIFACT_OUTPUT_BYTES = 1_024;

/** Largest accepted artifact-preprocessor output body. */
const _MAXIMUM_ARTIFACT_OUTPUT_BYTES = 64 * 1_024 * 1_024;

/** Default artifact-preprocessor output body limit. */
const _DEFAULT_ARTIFACT_OUTPUT_BYTES = 16 * 1_024 * 1_024;

/** Receiver-id prefix reserved for migrated route rows; a configured receiver id may never use it. */
const _LEGACY_CHANNEL_ROUTE_RECEIVER_PREFIX = "legacy-route-v0:";

/** Read one bounded whole-number setting from the startup environment. */
function _readBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = process.env[name]?.trim();
	if (!raw)
		return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
	{
		throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	}
	return value;
}

/** Read one bounded seconds setting and return it in milliseconds. */
function _readBoundedSeconds(name: string, fallbackSeconds: number, minimumSeconds: number, maximumSeconds: number): number
{
	return _readBoundedInteger(name, fallbackSeconds, minimumSeconds, maximumSeconds) * 1_000;
}

/** Require one non-empty setting so a missing chart value fails boot instead of composing a dead client. */
function _readRequired(name: string): string
{
	const value = process.env[name]?.trim() ?? "";
	if (value.length === 0)
		throw new Error(`${name} is required`);
	return value;
}

/** Require one credential-free HTTPS origin for a browser-visible or external authority boundary. */
function _readCredentialFreeHttpsOrigin(name: string): string
{
	const value = _readRequired(name);
	let origin: URL;
	try { origin = new URL(value); }
	catch { throw new Error(`${name} must be an absolute HTTPS origin`); }
	if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
	{
		throw new Error(`${name} must be one credential-free HTTPS origin`);
	}
	return value;
}

/** Require one absolute mounted-file path for the projected memory-gateway caller token. */
function _readRequiredAbsolutePath(name: string): string
{
	const value = _readRequired(name);
	if (!value.startsWith("/"))
		throw new Error(`${name} must be an absolute path`);
	return value;
}

/** Read the maximum artifact-preprocessor output size; the server-side promotion broker uses the same limit. */
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

/** Read the email and ClusterTenant that let one verified OIDC user claim this standalone silo's owner slot; both must be set or neither. */
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
 * Reads the startup-selected owner of organisation membership decisions.
 *
 * Standalone mode requires a mounted invitation-signing key, while Fleet mode requires its HTTPS
 * membership-and-billing gateway and projected-token coordinates. Invalid or incomplete settings
 * stop startup so a Fleet failure can never fall back to local membership writes.
 *
 * Called by: apps/opencrane/src/app/routes.ts while mounting the organisation-member router.
 * @returns The complete configuration for exactly one deployment mode.
 * @throws When the mode, origin, mounted path, key, timeout, or required coordinate is invalid.
 */
export function _ReadOrganizationMembershipConfig(): OpenCraneOrganizationMembershipConfig
{
	const mode = process.env.OPENCRANE_MEMBERSHIP_MODE?.trim();
	if (mode === OrganizationMembershipDeploymentModes.Standalone)
	{
		const signingKeyPath = _readRequiredAbsolutePath("OPENCRANE_INVITATION_SIGNING_KEY_PATH");
		const publicBaseUrl = _readCredentialFreeHttpsOrigin("OPENCRANE_PUBLIC_BASE_URL");
		const invitationSigningKey = Buffer.from(readFileSync(signingKeyPath, "utf8").trim(), "base64url");
		if (invitationSigningKey.byteLength < 32)
			throw new Error("OPENCRANE_INVITATION_SIGNING_KEY_PATH must contain at least 32 base64url-decoded bytes");
		return { mode, standalone: { invitationSigningKey, publicBaseUrl, invitationTtlMilliseconds: _readBoundedSeconds("OPENCRANE_INVITATION_TTL_SECONDS", 604_800, 300, 2_592_000) } };
	}
	if (mode === OrganizationMembershipDeploymentModes.Fleet)
	{
		const baseUrl = _readCredentialFreeHttpsOrigin("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_URL");
		return { mode, fleet: { baseUrl, credentialSiloId: _readRequired("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_SILO_ID"), projectedTokenPath: _readRequiredAbsolutePath("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_TOKEN_PATH"), timeoutMilliseconds: _readBoundedSeconds("OPENCRANE_MEMBERSHIP_BILLING_GATEWAY_TIMEOUT_SECONDS", 15, 1, 60) } };
	}
	throw new Error("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
}

/** Read the five channel resolver and replay receiver settings; all must be set or none. */
function _readChannelTargetConfig(): ChannelTargetRuntimeConfig | null
{
	const values = {
		channelProxyServiceAccountName: process.env.CHANNEL_PROXY_SERVICE_ACCOUNT_NAME?.trim() ?? "",
		receiverEndpoint: process.env.CHANNEL_REPLAY_ENDPOINT?.trim() ?? "",
		receiverId: process.env.CHANNEL_REPLAY_RECEIVER_ID?.trim() ?? "",
		siloId: process.env.CHANNEL_TARGET_SILO_ID?.trim() ?? "",
		trustedHost: process.env.CHANNEL_TARGET_TRUSTED_HOST?.trim().toLowerCase() ?? "",
	};
	if (Object.values(values).every(value => value.length === 0))
		return null;
	if (Object.values(values).some(value => value.length === 0))
		throw new Error("channel target resolver configuration must be complete");
	if (values.receiverId.startsWith(_LEGACY_CHANNEL_ROUTE_RECEIVER_PREFIX))
		throw new Error("CHANNEL_REPLAY_RECEIVER_ID uses the reserved legacy route namespace");
	return { ...values, invocationContextTtlMilliseconds: _readBoundedSeconds("CHANNEL_INVOCATION_CONTEXT_TTL_SECONDS", 60, 1, 300) };
}

/** Read the one bounded Absurd worker and remote MCP protocol-check configuration. */
function _readWorkflowConfig(): OpenCraneWorkflowConfig
{
	const ociRegistryAuthorizationFilePath = process.env.OPENCRANE_OCI_REGISTRY_AUTHORIZATION_FILE?.trim() || undefined;
	if (ociRegistryAuthorizationFilePath !== undefined && !isAbsolute(ociRegistryAuthorizationFilePath))
		throw new Error("OPENCRANE_OCI_REGISTRY_AUTHORIZATION_FILE must be an absolute mounted file path");
	return {
		databasePoolSize: _readBoundedInteger("OPENCRANE_WORKFLOW_DATABASE_POOL_SIZE", 2, 1, 20),
		databaseUrl: _readRequired("DATABASE_URL"),
		mcpEraProbeMaximumResponseBytes: _readBoundedInteger("OPENCRANE_MCP_ERA_PROBE_MAX_RESPONSE_BYTES", 65_536, 1_024, 1_048_576),
		mcpEraProbeTimeoutMilliseconds: _readBoundedInteger("OPENCRANE_MCP_ERA_PROBE_TIMEOUT_MS", 5_000, 1_000, 60_000),
		ociRegistryAuthorizationFilePath,
		ociRegistryBaseUrl: _readRequired("OPENCRANE_OCI_REGISTRY_BASE_URL"),
		ociRegistryRepository: _readRequired("OPENCRANE_OCI_REGISTRY_REPOSITORY"),
		ociRegistryTimeoutMilliseconds: _readBoundedInteger("OPENCRANE_OCI_REGISTRY_TIMEOUT_MS", 30_000, 1_000, 120_000),
		pollIntervalMilliseconds: _readBoundedInteger("OPENCRANE_WORKFLOW_POLL_INTERVAL_MS", 100, 10, 60_000),
		siloId: _readRequired("OPENCRANE_SILO_ID"),
		workerConcurrency: _readBoundedInteger("OPENCRANE_WORKFLOW_WORKER_CONCURRENCY", 2, 1, 20),
	};
}

/**
 * Read process settings once so listeners and workers share one startup snapshot.
 *
 * Runtime authorities, not this parser, still check that runtime namespaces are present and
 * distinct before using those namespaces in trusted workload routes.
 */
export function _ReadProcessConfig(): OpenCraneProcessConfig
{
	return {
		authWatchNamespace: process.env.WATCH_NAMESPACE ?? process.env.NAMESPACE ?? "default",
		internalPort: Number(process.env.INTERNAL_PORT ?? "8081"),
		publicPort: Number(process.env.PORT ?? "8080"),
			runtime: {
			artifactScannerEnabled: process.env.ARTIFACT_SCANNER_ENABLED === "true",
			artifactScannerClaimLeaseMilliseconds: _readBoundedSeconds("ARTIFACT_SCANNER_CLAIM_LEASE_SECONDS", 300, 60, 300),
			artifactScannerNamespace: process.env.ARTIFACT_SCANNER_NAMESPACE?.trim(),
			artifactPreprocessorEnabled: process.env.ARTIFACT_PREPROCESSOR_ENABLED === "true",
			artifactPreprocessorMaximumOutputBytes: _readArtifactPreprocessorBodyLimit(),
			artifactPreprocessorNamespace: process.env.ARTIFACT_PREPROCESSOR_NAMESPACE?.trim(),
			assignmentTtlMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS", 3_600, 60, 86_400),
			channelTargets: _readChannelTargetConfig(),
			commandRecoveryMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_COMMAND_RECOVERY_POLL_SECONDS", 5, 5, 300),
			commandTtlMilliseconds: _readBoundedSeconds("AGENT_RUNTIME_COMMAND_TTL_SECONDS", 60, 1, 300),
			continuationKeyringPath: _readRequiredAbsolutePath("AGENT_RUNTIME_CONTINUATION_KEYRING_PATH"),
				managedRuntimeNamespace: process.env.AGENT_RUNTIME_MANAGED_NAMESPACE?.trim(),
				mcpCompanionClaimLeaseMilliseconds: _readBoundedSeconds("MCP_COMPANION_CLAIM_LEASE_SECONDS", 150, 1, 300),
				mcpControllerClaimLeaseMilliseconds: _readBoundedSeconds("MCP_CONTROLLER_CLAIM_LEASE_SECONDS", 30, 1, 300),
				mcpExecutorNamespace: process.env.MCP_EXECUTOR_NAMESPACE?.trim(),
			memoryGatewayTimeoutMilliseconds: _readBoundedSeconds("MEMORY_GATEWAY_TIMEOUT_SECONDS", 30, 1, 300),
			memoryGatewayTokenPath: _readRequiredAbsolutePath("MEMORY_GATEWAY_TOKEN_PATH"),
			memoryGatewayUrl: _readRequired("MEMORY_GATEWAY_URL"),
			personalRuntimeNamespace: process.env.AGENT_RUNTIME_PERSONAL_NAMESPACE?.trim(),
			skillAuthoringNamespace: _readRequired("SKILL_AUTHORING_NAMESPACE"),
				serverNamespace: process.env.POD_NAMESPACE?.trim() || "default",
				siloId: _readRequired("OPENCRANE_SILO_ID"),
		},
		schedulerEnabled: process.env.OPENCRANE_SCHEDULER_ENABLED === "true",
		schedulerIntervalMilliseconds: _readBoundedInteger("OPENCRANE_SCHEDULER_INTERVAL_MS", 60_000, 1_000, 3_600_000),
		standaloneFirstUserAdmission: _readStandaloneFirstUserAdmission(),
		workflows: _readWorkflowConfig(),
	};
}
