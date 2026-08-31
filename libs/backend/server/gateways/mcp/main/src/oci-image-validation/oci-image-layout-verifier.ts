import { createHash } from "node:crypto";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { OciRegistryImportPlan } from "@opencrane/backend/server/infra/oci-registry";
import { ___ParseZipPackage } from "@opencrane/backend/server/utils";

import { OCI_IMAGE_LAYOUT_VERSION, OCI_IMAGE_MAXIMUM_BUNDLE_BYTES, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES, OciImageVerificationFailureCodes } from "./oci-image-validation.types";
import type { OciImageLayoutArtifactReader, OciImageLayoutArtifactTarget, OciImageLayoutVerifier, OciImageVerificationResult } from "./oci-image-validation.types";

/** OCI image manifest media type. */
const _OCI_IMAGE_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
/** Only an OCI image manifest may be selected from the layout index. */
const _OCI_IMAGE_MANIFEST_MEDIA_TYPES = new Set([_OCI_IMAGE_MANIFEST_MEDIA_TYPE]);
/** OCI image configuration media type. */
const _OCI_IMAGE_CONFIG_MEDIA_TYPE = "application/vnd.oci.image.config.v1+json";
/** Only an OCI image configuration may fill the manifest configuration slot. */
const _OCI_IMAGE_CONFIG_MEDIA_TYPES = new Set([_OCI_IMAGE_CONFIG_MEDIA_TYPE]);
/** OCI image-layer media types whose descriptor closure this admission understands. */
const _OCI_IMAGE_LAYER_MEDIA_TYPES = new Set([
	"application/vnd.oci.image.layer.v1.tar",
	"application/vnd.oci.image.layer.v1.tar+gzip",
	"application/vnd.oci.image.layer.v1.tar+zstd",
	"application/vnd.oci.image.layer.nondistributable.v1.tar",
	"application/vnd.oci.image.layer.nondistributable.v1.tar+gzip",
	"application/vnd.oci.image.layer.nondistributable.v1.tar+zstd",
]);
/** Canonical digest grammar accepted by the OCI layout. */
const _SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

/** Read a fully bounded artifact stream before archive parsing starts. */
async function _CollectLayoutZip(stream: ReadableStream<Uint8Array>, expectedLength: number): Promise<Buffer | null>
{
	const reader = stream.getReader();
	const chunks: Buffer[] = [];
	let byteLength = 0;
	let complete = false;
	try
	{
		while (true)
		{
			const next = await reader.read();
			if (next.done)
			{
				complete = true;
				break;
			}
			byteLength += next.value.byteLength;
			if (byteLength > expectedLength || byteLength > OCI_IMAGE_MAXIMUM_BUNDLE_BYTES)
				return null;
			chunks.push(Buffer.from(next.value));
		}
	}
	finally
	{
		if (!complete)
		{
			try { await reader.cancel(); }
			catch { /* The admission result must not expose or retry a storage cleanup failure. */ }
		}
		reader.releaseLock();
	}
	return byteLength === expectedLength ? Buffer.concat(chunks, byteLength) : null;
}

/**
 * Reads the saved artifact length and SHA-256 address again before validation or registry import.
 * A mismatch returns `null`, which keeps changed storage bytes from inheriting the admitted revision's identity.
 */
export async function _ReadOciImageLayoutZip(reader: OciImageLayoutArtifactReader, target: OciImageLayoutArtifactTarget): Promise<Buffer | null>
{
	if (!Number.isSafeInteger(target.byteLength) || target.byteLength < 0 || target.byteLength > OCI_IMAGE_MAXIMUM_BUNDLE_BYTES)
		return null;
	const layoutZip = await _CollectLayoutZip(await reader.read(target), target.byteLength);
	if (layoutZip === null)
		return null;
	return `sha256:${createHash("sha256").update(layoutZip).digest("hex")}` === target.contentAddress ? layoutZip : null;
}

/** Return an object only when JSON carries a non-null object value. */
function _Object(value: Buffer): Record<string, unknown> | null
{
	try
	{
		const parsed: unknown = JSON.parse(value.toString("utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
	}
	catch
	{
		return null;
	}
}

/** Return one descriptor only when it uses an allowed media type and bounded SHA-256 address. */
function _Descriptor(value: unknown, mediaTypes: ReadonlySet<string>, maximumBytes: number): { readonly mediaType: string; readonly digest: string; readonly size: number } | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const descriptor = value as Record<string, unknown>;
	const { mediaType, digest, size } = descriptor;
	if (typeof mediaType !== "string" || !mediaTypes.has(mediaType) || typeof digest !== "string" || !_SHA256_DIGEST.test(digest) || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > maximumBytes)
		return null;
	return { mediaType, digest, size };
}

/** Resolve one bounded content-addressed blob and verify its address before parsing it. */
function _ReadBlob(archive: ReturnType<typeof ___ParseZipPackage>, descriptor: { readonly digest: string; readonly size: number }, maximumBytes: number): Buffer | null
{
	if (archive === null)
		return null;
	const path = `blobs/sha256/${descriptor.digest.slice("sha256:".length)}`;
	const entry = archive.entries.find(function _MatchingEntry(candidate) { return candidate.path === path; });
	const bytes = entry === undefined ? null : archive.read(entry, maximumBytes);
	if (bytes === null || bytes.byteLength !== descriptor.size)
		return null;
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}` === descriptor.digest ? bytes : null;
}

/**
 * Validates one OCI Image Layout and retains the manifest, config, and layer bytes needed for import.
 * The index must select one image manifest so admission produces one digest-pinned runtime input.
 * @see https://github.com/opencontainers/image-spec/blob/v1.0.1/image-layout.md
 * @see https://github.com/opencontainers/image-spec/blob/v1.0.1/manifest.md
 */
export function _InspectOciImageLayoutForImport(layoutZip: Buffer): { readonly validation: OciImageVerificationResult; readonly plan: OciRegistryImportPlan | null }
{
	const archive = ___ParseZipPackage(layoutZip);
	if (archive === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.MalformedZipPackage }, plan: null };
	const layoutEntry = archive?.entries.find(function _Layout(candidate) { return candidate.path === "oci-layout"; });
	const indexEntry = archive?.entries.find(function _Index(candidate) { return candidate.path === "index.json"; });
	if (layoutEntry === undefined || indexEntry === undefined)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.NotOciImageLayout }, plan: null };
	const layout = _Object(archive.read(layoutEntry, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES) ?? Buffer.alloc(0));
	if (layout?.imageLayoutVersion !== OCI_IMAGE_LAYOUT_VERSION)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidLayout }, plan: null };
	const indexBytes = archive.read(indexEntry, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (indexBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const index = _Object(indexBytes);
	if (index === null || index.schemaVersion !== 2 || !Array.isArray(index.manifests) || index.manifests.length !== 1)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const manifestDescriptor = _Descriptor(index.manifests[0], _OCI_IMAGE_MANIFEST_MEDIA_TYPES, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (manifestDescriptor === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const manifestBytes = _ReadBlob(archive, manifestDescriptor, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (manifestBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const manifest = _Object(manifestBytes);
	if (manifest === null || manifest.schemaVersion !== 2 || (manifest.mediaType !== undefined && manifest.mediaType !== _OCI_IMAGE_MANIFEST_MEDIA_TYPE) || !Array.isArray(manifest.layers) || manifest.layers.length > archive.entries.length)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const config = _Descriptor(manifest.config, _OCI_IMAGE_CONFIG_MEDIA_TYPES, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	const configBytes = config === null ? null : _ReadBlob(archive, config, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (config === null || configBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const descriptorDigests = new Set([manifestDescriptor.digest]);
	if (descriptorDigests.has(config.digest))
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	descriptorDigests.add(config.digest);
	const blobs: { readonly digest: string; readonly bytes: Uint8Array }[] = [{ digest: config.digest, bytes: configBytes }];
	for (const candidate of manifest.layers)
	{
		const layer = _Descriptor(candidate, _OCI_IMAGE_LAYER_MEDIA_TYPES, OCI_IMAGE_MAXIMUM_BUNDLE_BYTES);
		const layerBytes = layer === null ? null : _ReadBlob(archive, layer, OCI_IMAGE_MAXIMUM_BUNDLE_BYTES);
		if (layer === null || layerBytes === null || descriptorDigests.has(layer.digest))
			return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
		descriptorDigests.add(layer.digest);
		blobs.push({ digest: layer.digest, bytes: layerBytes });
	}
	const validation: OciImageVerificationResult = {
		accepted: true, layout: {
			indexDigest: `sha256:${createHash("sha256").update(indexBytes).digest("hex")}`,
			imageManifestDigest: manifestDescriptor.digest,
			configDigest: config.digest,
		},
	};
	return { validation, plan: { blobs, manifest: { digest: manifestDescriptor.digest, mediaType: manifestDescriptor.mediaType, bytes: manifestBytes } } };
}

/** Returns the layout decision without exposing the byte plan used by the registry importer. */
export function _InspectOciImageLayout(layoutZip: Buffer): OciImageVerificationResult
{
	return _InspectOciImageLayoutForImport(layoutZip).validation;
}

/**
 * Creates the adapter that checks one saved OCI Image Layout upload without extracting or running it.
 * The workflow receives stable rejection codes rather than parser or storage details.
 */
export function __CreateOciImageLayoutVerifier(reader: OciImageLayoutArtifactReader): OciImageLayoutVerifier
{
	return {
		async verify(target: OciImageLayoutArtifactTarget): Promise<OciImageVerificationResult>
		{
			return ___DoWithTrace("oci-image-layout.verify", { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId, byteLength: target.byteLength }, async function _VerifyLayout(): Promise<OciImageVerificationResult>
			{
				const layoutZip = await _ReadOciImageLayoutZip(reader, target);
				if (layoutZip === null)
					return { accepted: false, failureCode: target.byteLength > OCI_IMAGE_MAXIMUM_BUNDLE_BYTES ? OciImageVerificationFailureCodes.BundleTooLarge : OciImageVerificationFailureCodes.ArtifactMismatch };
				return _InspectOciImageLayout(layoutZip);
			});
		},
	};
}
