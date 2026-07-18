import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { ArtifactServiceProcessConfig } from "./config.types.js";

/** Read configuration without accepting a runtime-local or relative byte root. */
export function _ReadConfig(environment: NodeJS.ProcessEnv = process.env): ArtifactServiceProcessConfig
{
	const artifactRoot = environment.ARTIFACT_ROOT ?? "/var/lib/opencrane/artifacts";
	if (!isAbsolute(artifactRoot))
	{
		throw new Error("ARTIFACT_ROOT must be an absolute mounted path");
	}
	return {
		port: _PositiveInteger(environment.PORT, 8080, "PORT"),
		artifactRoot,
		maxUploadDurationMilliseconds: _PositiveInteger(environment.ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS, 300_000, "ARTIFACT_MAX_UPLOAD_DURATION_MILLISECONDS"),
		leasePublicKeyPem: _ReadPem(environment.ARTIFACT_LEASE_PUBLIC_KEY_PATH, "ARTIFACT_LEASE_PUBLIC_KEY_PATH"),
		receiptPrivateKeyPem: _ReadPem(environment.ARTIFACT_RECEIPT_PRIVATE_KEY_PATH, "ARTIFACT_RECEIPT_PRIVATE_KEY_PATH"),
	};
}

/** Load one distinct mounted PEM key without accepting a raw environment secret. */
function _ReadPem(path: string | undefined, name: string): string
{
	if (path === undefined || !isAbsolute(path))
	{
		throw new Error(`${name} must identify an absolute mounted key path`);
	}
	const value = readFileSync(path, "utf8");
	if (!value.includes("-----BEGIN ") || !value.includes(" KEY-----"))
	{
		throw new Error(`${name} must contain a PEM key`);
	}
	return value;
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
