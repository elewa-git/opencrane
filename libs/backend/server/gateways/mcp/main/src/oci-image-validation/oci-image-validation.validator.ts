import type { OciImageValidationTaskInput } from "./oci-image-validation.types";

/** Durable identifier accepted in an OCI image task. */
const _IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
/** Canonical SHA-256 digest saved in task input. */
const _DIGEST = /^sha256:[a-f0-9]{64}$/u;
/** Bounded media type copied from an immutable artifact revision. */
const _MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;

/** Throw before malformed product coordinates can reach a workflow engine or database adapter. */
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
