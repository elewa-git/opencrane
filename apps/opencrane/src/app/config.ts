import type { OpenCraneProcessConfig } from "./config.types.js";

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
 * Read process settings once so listeners and workers share one startup snapshot.
 *
 * Runtime namespace presence and separation remain worker invariants because those values grant
 * Kubernetes cleanup authority; parsing configuration alone must not make that trust decision.
 */
export function _ReadProcessConfig(): OpenCraneProcessConfig
{
	return {
		authWatchNamespace: process.env.WATCH_NAMESPACE ?? process.env.NAMESPACE ?? "default",
		internalPort: Number(process.env.INTERNAL_PORT ?? "8081"),
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
	};
}
