import { MCPB_MAXIMUM_BUNDLE_BYTES } from "./mcpb-validation.types";
import type { McpbValidationTaskInput } from "./mcpb-validation.types";

/** Durable identifier accepted in an MCP bundle task. */
const _IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
/** Canonical SHA-256 digest saved in task input. */
const _DIGEST = /^sha256:[a-f0-9]{64}$/u;
/** Bounded media type copied from an immutable artifact revision. */
const _MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/iu;

/** Throw before malformed product coordinates can reach a workflow engine or database adapter. */
export function __AssertMcpbValidationTaskInput(input: McpbValidationTaskInput): void
{
	if (!_IDENTIFIER.test(input.siloId) || !_IDENTIFIER.test(input.validationId) || !_IDENTIFIER.test(input.artifactId) || !_IDENTIFIER.test(input.artifactRevisionId))
		throw new Error("MCP bundle task identifiers are invalid.");
	if (!_DIGEST.test(input.contentAddress) || !_DIGEST.test(input.submissionDigest))
		throw new Error("MCP bundle task digests are invalid.");
	if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0 || input.byteLength > MCPB_MAXIMUM_BUNDLE_BYTES)
		throw new Error("MCP bundle task byte length is invalid.");
	if (!_MEDIA_TYPE.test(input.mediaType))
		throw new Error("MCP bundle task media type is invalid.");
}
