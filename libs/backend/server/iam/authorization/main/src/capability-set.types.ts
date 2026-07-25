import type { CanonicalJsonSha256Digest, CapabilityReference } from "@opencrane/models/authorization";

/** Canonical immutable capability set with its content-addressed digest. */
export interface CapabilitySet
{
	/** Deterministically ordered unique capability references. */
	readonly capabilities: readonly CapabilityReference[];
	/** SHA-256 digest of the complete ordered capability set. */
	readonly digest: CanonicalJsonSha256Digest;
}
