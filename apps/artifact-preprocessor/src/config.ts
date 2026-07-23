import { isAbsolute } from "node:path";

import type { ArtifactPreprocessorProcessConfig } from "./config.types.js";

/** Read one required, trimmed environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

/** Parse a bounded safe integer or use its explicit default. */
function _Integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
	{
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
	}
	return value;
}

/** Require an absolute locally mounted path, never a relative working-directory escape. */
function _AbsolutePath(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = _Required(environment, name);
	if (!isAbsolute(value)) throw new Error(`${name} must be absolute`);
	return value;
}

/** Read and fail-closed validate the complete preprocessing worker configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessorProcessConfig
{
	return {
		openCraneInternalUrl: _Required(environment, "OPENCRANE_INTERNAL_URL"),
		artifactServiceUrl: _Required(environment, "ARTIFACT_SERVICE_URL"),
		tokenPath: _AbsolutePath(environment, "OPENCRANE_PREPROCESSOR_TOKEN_PATH"),
		scratchDirectory: _AbsolutePath(environment, "ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY"),
		pollIntervalMilliseconds: _Integer(environment, "ARTIFACT_PREPROCESSOR_POLL_INTERVAL_MS", 1_000, 100, 60_000),
		requestTimeoutMilliseconds: _Integer(environment, "ARTIFACT_PREPROCESSOR_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
		maximumSourceBytes: _Integer(environment, "ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES", 33_554_432, 1, 536_870_912),
		maximumOutputBytes: _Integer(environment, "ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES", 16_777_216, 0, 536_870_912),
		conversionTimeoutMilliseconds: _Integer(environment, "ARTIFACT_PREPROCESSOR_CONVERSION_TIMEOUT_MS", 30_000, 1_000, 300_000),
	};
}
