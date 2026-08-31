import { z } from "zod";

import { OCI_IMAGE_LAYOUT_VERSION, OCI_IMAGE_MAXIMUM_BUNDLE_BYTES, OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES, type OciImageValidationTaskInput } from "./oci-image-validation.types";

/**
 * Validate untrusted OCI JSON beside the OCI admission code so the verifier does not keep a second
 * field parser that can drift from the accepted image-layout shape.
 *
 * Called by: `_InspectOciImageLayoutForImport` before it follows any descriptor from the ZIP.
 */

/** Durable identifier accepted in an OCI image task. */
const _IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
/** Canonical SHA-256 digest saved in task input. */
const _DIGEST = /^sha256:[a-f0-9]{64}$/u;
/** Bounded media type copied from an immutable artifact revision. */
const _MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;

/** Accepts the layout revision before the verifier reads its `index.json` selection. */
export const _OciImageLayoutDocumentSchema = z.object({
	imageLayoutVersion: z.literal(OCI_IMAGE_LAYOUT_VERSION),
}).passthrough();

/**
 * Accepts one image-manifest selection from an index.
 *
 * Admission builds one registry import plan, so zero or multiple selections cannot identify the
 * image that a later runtime claim may use.
 */
export const _OciImageIndexDocumentSchema = z.object({
	schemaVersion: z.literal(2),
	manifests: z.array(z.unknown()).length(1),
}).passthrough();

/** Keeps the config and layer descriptor checks separate from the enclosing image manifest. */
export const _OciImageManifestDocumentSchema = z.object({
	schemaVersion: z.literal(2),
	mediaType: z.literal("application/vnd.oci.image.manifest.v1+json").optional(),
	config: z.unknown(),
	layers: z.array(z.unknown()),
	}).passthrough();

/** Bounds the manifest bytes before the verifier reads the descriptor selected by the index. */
export const _OciImageManifestDescriptorSchema = z.object({
	mediaType: z.literal("application/vnd.oci.image.manifest.v1+json"),
	digest: z.string().regex(_DIGEST),
	size: z.number().int().nonnegative().max(OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES),
}).passthrough();

/** Bounds the configuration bytes before the verifier reads the descriptor named by the manifest. */
export const _OciImageConfigDescriptorSchema = z.object({
	mediaType: z.literal("application/vnd.oci.image.config.v1+json"),
	digest: z.string().regex(_DIGEST),
	size: z.number().int().nonnegative().max(OCI_IMAGE_MAXIMUM_DOCUMENT_BYTES),
}).passthrough();

/** Allows layer bytes up to the archive ceiling because a layer can be the uploaded image's largest object. */
export const _OciImageLayerDescriptorSchema = z.object({
	mediaType: z.union([
		z.literal("application/vnd.oci.image.layer.v1.tar"),
		z.literal("application/vnd.oci.image.layer.v1.tar+gzip"),
		z.literal("application/vnd.oci.image.layer.v1.tar+zstd"),
		z.literal("application/vnd.oci.image.layer.nondistributable.v1.tar"),
		z.literal("application/vnd.oci.image.layer.nondistributable.v1.tar+gzip"),
		z.literal("application/vnd.oci.image.layer.nondistributable.v1.tar+zstd"),
	]),
	digest: z.string().regex(_DIGEST),
	size: z.number().int().nonnegative().max(OCI_IMAGE_MAXIMUM_BUNDLE_BYTES),
}).passthrough();

/**
 * Stops malformed saved task input before it reaches the workflow engine or database adapter.
 *
 * Called by: `__OciImageValidationTaskKey` and the registered OCI validation task handler.
 * @throws Error When any saved identifier, digest, byte length, or media type is malformed.
 */
export function __AssertOciImageValidationTaskInput(input: OciImageValidationTaskInput): void
{
	if (!_IDENTIFIER.test(input.siloId) || !_IDENTIFIER.test(input.validationId) || !_IDENTIFIER.test(input.artifactId) || !_IDENTIFIER.test(input.artifactRevisionId))
		throw new Error("OCI image task identifiers are invalid.");
	if (!_DIGEST.test(input.contentAddress) || !_DIGEST.test(input.submissionDigest))
		throw new Error("OCI image task digests are invalid.");
	if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0)
		throw new Error("OCI image task byte length is invalid.");
	if (!_MEDIA_TYPE.test(input.mediaType))
		throw new Error("OCI image task media type is invalid.");
}
