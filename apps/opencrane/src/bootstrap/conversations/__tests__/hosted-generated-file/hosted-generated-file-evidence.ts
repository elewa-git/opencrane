import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import type { HostedGeneratedFileAsset, HostedGeneratedFileEvidence, HostedGeneratedFileOciValidation, HostedGeneratedFileRestartCheckpoint } from "./hosted-generated-file.types";

/** Return the canonical SHA-256 content address of exact bytes. */
export function __HostedGeneratedFileDigest(bytes: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Require the published upload and OCI validation to name the same immutable bytes. */
export function __AssertHostedOciContinuity(asset: HostedGeneratedFileAsset, validation: HostedGeneratedFileOciValidation, archive: Uint8Array): void
{
	const digest = __HostedGeneratedFileDigest(archive);
	if (asset.state !== "ready" || asset.artifactId === null || asset.artifactRevisionId === null)
		throw new Error("Hosted OCI upload did not reach a published Ready revision");
	if (asset.mediaType !== "application/zip" || asset.byteLength !== archive.byteLength)
		throw new Error("Hosted OCI upload media type or byte length drifted");
	if (validation.state !== "Imported" || validation.artifactId !== asset.artifactId || validation.artifactRevisionId !== asset.artifactRevisionId)
		throw new Error("Hosted OCI validation did not import the exact published revision");
	if (validation.contentAddress !== digest || validation.byteLength !== archive.byteLength || validation.mediaType !== "application/zip")
		throw new Error("Hosted OCI validation byte identity drifted from the uploaded archive");
	if (!_Digest(validation.indexDigest) || !_Digest(validation.imageManifestDigest) || !_Digest(validation.configDigest) || !_RegistryReference(validation.registryReference))
		throw new Error("Hosted OCI validation omitted checked layout or digest-pinned registry evidence");
}

/** Require the restarted public download to preserve the expected file response. */
export function __AssertHostedDownload(bytes: Uint8Array, expected: Uint8Array, mediaType: string | null, cacheControl: string | null): void
{
	if (!Buffer.from(bytes).equals(Buffer.from(expected)))
		throw new Error("Hosted generated-file download bytes changed after restart");
	if (mediaType !== "text/csv;charset=utf-8")
		throw new Error("Hosted generated-file download media type is not the CSV producer contract");
	if (cacheControl !== "private, no-store")
		throw new Error("Hosted generated-file download is missing private no-store caching");
}

/** Serialize only the redacted evidence schema accepted by platform collection. */
export function __SerializeHostedGeneratedFileEvidence(evidence: HostedGeneratedFileEvidence): string
{
	return `${JSON.stringify(evidence, null, 2)}\n`;
}

/** Persist the redacted pre-restart coordinates without replacing an earlier run. */
export async function __WriteHostedGeneratedFileCheckpoint(path: string, checkpoint: HostedGeneratedFileRestartCheckpoint): Promise<void>
{
	await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

/** Load the checkpoint and reject missing or extra top-level evidence fields. */
export async function __LoadHostedGeneratedFileCheckpoint(path: string): Promise<HostedGeneratedFileRestartCheckpoint>
{
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Hosted restart checkpoint must be a JSON object");
	const record = value as Record<string, unknown>;
	const keys = ["schemaVersion", "conversationId", "activationText", "activationIdempotencyKey", "activationOutcome", "activationPosition", "expectedCsvContentAddress", "expectedCsvByteLength", "finalPosition", "outputAssetId", "outputArtifactId", "outputArtifactRevisionId", "outputDisplayName", "outputMediaType", "uploadAssetId", "runId", "runAttempt", "runAgentRevisionId", "principalId", "siloId", "oci"];
	if (Object.keys(record).some(function _Unknown(key) { return !keys.includes(key); }) || keys.some(function _Missing(key) { return !(key in record); }) || record["schemaVersion"] !== 1)
		throw new Error("Hosted restart checkpoint has an unsupported shape");
	return record as unknown as HostedGeneratedFileRestartCheckpoint;
}

/** Return whether a value is one canonical SHA-256 address. */
function _Digest(value: string | null): value is string
{
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** Return whether a registry reference is immutable and credentialless. */
function _RegistryReference(value: string | null): value is string
{
	if (typeof value !== "string" || !/@sha256:[0-9a-f]{64}$/u.test(value))
		return false;
	try
	{
		const parsed = new URL(`https://${value.split("/")[0]}`);
		return parsed.username === "" && parsed.password === "";
	}
	catch
	{
		return false;
	}
}
