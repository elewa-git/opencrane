import { createHash } from "node:crypto";

import { OciRegistryImportError } from "./oci-registry.errors";
import { OciRegistryImportErrorCodes } from "./oci-registry.types";
import type { OciRegistryImportPlan } from "./oci-registry.types";

/** SHA-256 digest grammar accepted by this image import path. */
const _SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
/** OCI image manifest type accepted by the admission flow that calls this package. */
const _OCI_IMAGE_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";

/** Returns the SHA-256 address for the supplied bytes. */
function _sha256(bytes: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Asserts that checked bytes still match their declared address before registry I/O begins. */
function _AssertContent(digest: string, bytes: Uint8Array, label: string): void
{
	if (!_SHA256_DIGEST_PATTERN.test(digest) || _sha256(bytes) !== digest)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidPlan, `${label} bytes do not match their SHA-256 digest`);
}

/**
 * Checks the admitted import plan again before registry I/O uses its bytes.
 *
 * Called by: `__CreateOciRegistryClient` for every import attempt.
 *
 * @param plan - Manifest, configuration, and layer bytes produced by OCI admission.
 * @throws OciRegistryImportError When bytes, digests, or media type disagree.
 */
export function _CheckOciRegistryImportPlan(plan: OciRegistryImportPlan): void
{
	_AssertContent(plan.manifest.digest, plan.manifest.bytes, "Manifest");
	if (plan.manifest.mediaType !== _OCI_IMAGE_MANIFEST_MEDIA_TYPE)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidPlan, "Manifest media type is not an OCI image manifest");
	if (plan.blobs.length === 0)
		throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidPlan, "Import plan has no config or layer blobs");

	const seen = new Set<string>();
	for (const blob of plan.blobs)
	{
		_AssertContent(blob.digest, blob.bytes, "Blob");
		if (seen.has(blob.digest))
			throw new OciRegistryImportError(OciRegistryImportErrorCodes.InvalidPlan, "Import plan contains a repeated blob digest");
		seen.add(blob.digest);
	}
}
