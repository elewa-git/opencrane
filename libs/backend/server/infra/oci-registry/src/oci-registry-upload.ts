import { OciRegistryImportError } from "./oci-registry.errors";
import { _CheckOciRegistryDigest, _ExpectOciRegistryStatus, _OciRegistryRequest, _OciRegistryUploadLocation, _OciRegistryUrl, _RequireOciRegistryHeader } from "./oci-registry-http";
import { OciRegistryImportErrorCodes } from "./oci-registry.types";
import type { OciRegistryBlob, OciRegistryContext, OciRegistryImportPlan } from "./oci-registry.types";

/** Copies admitted bytes into the ArrayBuffer body type accepted by every supported Fetch API. */
function _requestBody(bytes: Uint8Array): ArrayBuffer
{
	return new Uint8Array(bytes).buffer;
}

/** Appends the digest without rewriting registry-owned upload-session query fields. */
function _blobUploadUrl(location: URL, digest: string): URL
{
	const separator = location.search.length === 0 ? "?" : "&";
	return new URL(`${location.href}${separator}digest=${encodeURIComponent(digest)}`);
}

/** Checks whether the configured repository already contains one blob. */
async function _blobExists(context: OciRegistryContext, blob: OciRegistryBlob): Promise<boolean>
{
	const url = _OciRegistryUrl(context, `/v2/${context.repositoryPath}/blobs/${blob.digest}`);
	const response = await _OciRegistryRequest(context, "Blob check", url, { method: "HEAD" });
	if (response.status === 404)
		return false;
	_ExpectOciRegistryStatus(response, 200, "Blob check");
	_CheckOciRegistryDigest(response, blob.digest, "Blob check");
	const length = response.headers.get("Content-Length");
	if (length !== null && length !== String(blob.bytes.byteLength))
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidRegistryResponse, "Blob check returned a different content length", response.status);
	return true;
}

/** Uploads one missing blob through the OCI Distribution POST-then-PUT flow. */
async function _uploadBlob(context: OciRegistryContext, blob: OciRegistryBlob): Promise<void>
{
	// 1. Ask the repository for an upload session instead of inventing a session URL.
	const startUrl = _OciRegistryUrl(context, `/v2/${context.repositoryPath}/blobs/uploads/`);
	const started = await _OciRegistryRequest(context, "Blob upload start", startUrl, { method: "POST", headers: { "Content-Length": "0" } });
	_ExpectOciRegistryStatus(started, 202, "Blob upload start");

	// 2. Keep any registry query fields and add the content digest required to close the session.
	const uploadUrl = _blobUploadUrl(_OciRegistryUploadLocation(context, started), blob.digest);

	// 3. Send the complete blob in the closing request so the registry can verify it atomically.
	const uploaded = await _OciRegistryRequest(context, "Blob upload", uploadUrl, { method: "PUT", headers: { "Content-Length": String(blob.bytes.byteLength), "Content-Type": "application/octet-stream" }, body: _requestBody(blob.bytes) });
	_ExpectOciRegistryStatus(uploaded, 201, "Blob upload");
	_RequireOciRegistryHeader(uploaded, "Location", "Blob upload");
	_CheckOciRegistryDigest(uploaded, blob.digest, "Blob upload");
}

/**
 * Ensures one referenced blob exists, skipping bytes the repository already has.
 *
 * Called by: `__CreateOciRegistryClient` for every config and layer blob.
 *
 * @param context - Fixed registry and repository settings.
 * @param blob - Checked bytes and their SHA-256 digest.
 * @throws OciRegistryImportError When the check or upload fails.
 */
export async function _EnsureOciRegistryBlob(context: OciRegistryContext, blob: OciRegistryBlob): Promise<void>
{
	if (await _blobExists(context, blob))
		return;
	await _uploadBlob(context, blob);
}

/**
 * Stores the checked manifest at its immutable digest address.
 *
 * Called by: `__CreateOciRegistryClient` after every referenced blob exists.
 *
 * @param context - Fixed registry and repository settings.
 * @param plan - Checked manifest bytes and media type.
 * @throws OciRegistryImportError When the registry rejects or renames the manifest.
 */
export async function _UploadOciRegistryManifest(context: OciRegistryContext, plan: OciRegistryImportPlan): Promise<void>
{
	const url = _OciRegistryUrl(context, `/v2/${context.repositoryPath}/manifests/${plan.manifest.digest}`);
	const response = await _OciRegistryRequest(context, "Manifest upload", url, { method: "PUT", headers: { "Content-Length": String(plan.manifest.bytes.byteLength), "Content-Type": plan.manifest.mediaType }, body: _requestBody(plan.manifest.bytes) });
	_ExpectOciRegistryStatus(response, 201, "Manifest upload");
	_RequireOciRegistryHeader(response, "Location", "Manifest upload");
	_RequireOciRegistryHeader(response, "Docker-Content-Digest", "Manifest upload");
	_CheckOciRegistryDigest(response, plan.manifest.digest, "Manifest upload");
}
