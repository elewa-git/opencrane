import { isAbsolute } from "node:path";

import type { ArtifactPreprocessorProcessConfig } from "./config.types";

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

/** Require an absolute path on a mounted volume; a relative path could escape the working directory. */
function _AbsolutePath(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = _Required(environment, name);
	if (!isAbsolute(value)) throw new Error(`${name} must be absolute`);
	return value;
}

/** Require the credential-free cluster-local origin owned by the OpenCrane internal Service. */
function _OpenCraneInternalUrl(environment: NodeJS.ProcessEnv): string
{
	const parsed = new URL(_Required(environment, "OPENCRANE_INTERNAL_URL"));
	if (parsed.protocol !== "http:"
		|| parsed.username
		|| parsed.password
		|| !parsed.hostname.endsWith(".svc.cluster.local")
		|| (parsed.pathname !== "" && parsed.pathname !== "/")
		|| parsed.search
		|| parsed.hash)
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be a credential-free cluster-local HTTP origin");
	}
	return parsed.toString().replace(/\/$/u, "");
}

/** Read and fail-closed validate the complete preprocessing worker configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessorProcessConfig
{
	return {
		openCraneInternalUrl: _OpenCraneInternalUrl(environment),
		tokenPath: _AbsolutePath(environment, "OPENCRANE_PREPROCESSOR_TOKEN_PATH"),
		bootstrapReferencePath: _AbsolutePath(environment, "OPENCRANE_PREPROCESSOR_BOOTSTRAP_REFERENCE_PATH"),
		scratchDirectory: _AbsolutePath(environment, "ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY"),
		requestTimeoutMilliseconds: _Integer(environment, "ARTIFACT_PREPROCESSOR_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
		maximumSourceBytes: _Integer(environment, "ARTIFACT_PREPROCESSOR_MAX_SOURCE_BYTES", 33_554_432, 1, 536_870_912),
		maximumOutputBytes: _Integer(environment, "ARTIFACT_PREPROCESSOR_MAX_OUTPUT_BYTES", 16_777_216, 1_024, 67_108_864),
		conversionTimeoutMilliseconds: _Integer(environment, "ARTIFACT_PREPROCESSOR_CONVERSION_TIMEOUT_MS", 30_000, 1_000, 300_000),
	};
}
