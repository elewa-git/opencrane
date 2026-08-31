/** Separates the registry path from its immutable manifest digest. */
const _DIGEST_SEPARATOR = "@sha256:";

/** Accepts one lowercase SHA-256 manifest digest. */
const _DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

/** Accepts the registry host and its optional port. */
const _REGISTRY_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/u;

/** Accepts one non-empty repository path segment. */
const _REPOSITORY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

/** Checks one repository path segment without allowing another path separator. */
function _IsRepositorySegment(value: string): boolean { return _REPOSITORY_SEGMENT_PATTERN.test(value); }

/**
 * Accepts one immutable OCI registry reference without a backtracking path expression.
 *
 * Called by: MCP executor controller response admission and Kubernetes Job construction.
 * @param value - Untrusted registry coordinate.
 * @returns Whether the value names a repository manifest by its SHA-256 digest.
 */
export function __IsImmutableRegistryReference(value: unknown): value is string
{
	if (typeof value !== "string")
		return false;
	const separatorIndex = value.indexOf(_DIGEST_SEPARATOR);
	if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf(_DIGEST_SEPARATOR))
		return false;
	const locator = value.slice(0, separatorIndex);
	const digest = value.slice(separatorIndex + _DIGEST_SEPARATOR.length);
	const [registry, ...repository] = locator.split("/");
	return registry !== undefined && _REGISTRY_PATTERN.test(registry) && repository.length > 0 && repository.every(_IsRepositorySegment) && _DIGEST_PATTERN.test(digest);
}
