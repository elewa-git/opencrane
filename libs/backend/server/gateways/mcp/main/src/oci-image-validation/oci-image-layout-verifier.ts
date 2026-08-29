import { createHash } from "node:crypto";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { OciRegistryImportPlan } from "@opencrane/backend/server/infra/oci-registry";
import { ___ParseZipPackage } from "@opencrane/backend/server/utils";

import { OCI_IMAGE_MAXIMUM_BUNDLE_BYTES, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES, OciImageVerificationFailureCodes } from "./oci-image-validation.types";
import type { OciImageLayoutArtifactReader, OciImageLayoutArtifactTarget, OciImageLayoutVerifier, OciImageVerificationResult } from "./oci-image-validation.types";
import { _OciImageConfigDescriptorSchema, _OciImageIndexDocumentSchema, _OciImageLayerDescriptorSchema, _OciImageLayoutDocumentSchema, _OciImageManifestDescriptorSchema, _OciImageManifestDocumentSchema } from "./oci-image-validation.validator";


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

/** Parse one bounded JSON document without copying a parser failure into the admission record. */
function _Json(value: Buffer): unknown | null
{
	try
	{
		return JSON.parse(value.toString("utf8")) as unknown;
	}
	catch
	{
		return null;
	}
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
	const layout = _OciImageLayoutDocumentSchema.safeParse(_Json(archive.read(layoutEntry, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES) ?? Buffer.alloc(0)));
	if (!layout.success)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidLayout }, plan: null };
	const indexBytes = archive.read(indexEntry, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (indexBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const index = _OciImageIndexDocumentSchema.safeParse(_Json(indexBytes));
	if (!index.success)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const manifestDescriptor = _OciImageManifestDescriptorSchema.safeParse(index.data.manifests[0]);
	if (!manifestDescriptor.success)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex }, plan: null };
	const manifestBytes = _ReadBlob(archive, manifestDescriptor.data, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (manifestBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const manifest = _OciImageManifestDocumentSchema.safeParse(_Json(manifestBytes));
	if (!manifest.success || manifest.data.layers.length > archive.entries.length)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const config = _OciImageConfigDescriptorSchema.safeParse(manifest.data.config);
	if (!config.success)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const configBytes = _ReadBlob(archive, config.data, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES);
	if (configBytes === null)
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	const descriptorDigests = new Set([manifestDescriptor.data.digest]);
	if (descriptorDigests.has(config.data.digest))
		return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
	descriptorDigests.add(config.data.digest);
	const blobs: { readonly digest: string; readonly bytes: Uint8Array }[] = [{ digest: config.data.digest, bytes: configBytes }];
	for (const candidate of manifest.data.layers)
	{
		const layer = _OciImageLayerDescriptorSchema.safeParse(candidate);
		if (!layer.success)
			return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
		const layerBytes = _ReadBlob(archive, layer.data, OCI_IMAGE_MAXIMUM_BUNDLE_BYTES);
		if (layerBytes === null || descriptorDigests.has(layer.data.digest))
			return { validation: { accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest }, plan: null };
		descriptorDigests.add(layer.data.digest);
		blobs.push({ digest: layer.data.digest, bytes: layerBytes });
	}
	const validation: OciImageVerificationResult = {
		accepted: true, layout: {
			indexDigest: `sha256:${createHash("sha256").update(indexBytes).digest("hex")}`,
			imageManifestDigest: manifestDescriptor.data.digest,
			configDigest: config.data.digest,
		},
	};
	return { validation, plan: { blobs, manifest: { digest: manifestDescriptor.data.digest, mediaType: manifestDescriptor.data.mediaType, bytes: manifestBytes } } };
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
				return _InspectOciImageLayoutForImport(layoutZip).validation;
			});
		},
	};
}
