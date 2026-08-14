import { isAbsolute } from "node:path";

import type { ArtifactScannerProcessConfig } from "./config.types";

/** Read and fail-closed validate the scanner configuration. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): ArtifactScannerProcessConfig
{
	return { openCraneInternalUrl: _OpenCraneInternalUrl(environment), tokenPath: _Absolute(environment, "OPENCRANE_SCANNER_TOKEN_PATH"), scratchDirectory: _Absolute(environment, "ARTIFACT_SCANNER_SCRATCH_DIRECTORY"), executablePath: _Absolute(environment, "ARTIFACT_SCANNER_EXECUTABLE_PATH"), databasePath: _Absolute(environment, "ARTIFACT_SCANNER_DATABASE_PATH"), scannerVersion: _Required(environment, "ARTIFACT_SCANNER_VERSION"), pollIntervalMilliseconds: _Integer(environment, "ARTIFACT_SCANNER_POLL_INTERVAL_MS", 1_000, 100, 60_000), requestTimeoutMilliseconds: _Integer(environment, "ARTIFACT_SCANNER_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000), maximumSourceBytes: _Integer(environment, "ARTIFACT_SCANNER_MAX_SOURCE_BYTES", 209_715_200, 1, 209_715_200), scanTimeoutMilliseconds: _Integer(environment, "ARTIFACT_SCANNER_SCAN_TIMEOUT_MS", 120_000, 1_000, 600_000) };
}

/** Require one non-empty environment value. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

/** Require an absolute mounted path. */
function _Absolute(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = _Required(environment, name);
	if (!isAbsolute(value)) throw new Error(`${name} must be absolute`);
	return value;
}

/** Read a bounded positive integer. */
function _Integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	return value;
}

/** Require a credential-free cluster-local HTTP origin. */
function _OpenCraneInternalUrl(environment: NodeJS.ProcessEnv): string
{
	const parsed = new URL(_Required(environment, "OPENCRANE_INTERNAL_URL"));
	if (parsed.protocol !== "http:" || parsed.username || parsed.password || !parsed.hostname.endsWith(".svc.cluster.local") || parsed.search || parsed.hash) throw new Error("OPENCRANE_INTERNAL_URL must be a credential-free cluster-local HTTP origin");
	return parsed.toString().replace(/\/$/u, "");
}
