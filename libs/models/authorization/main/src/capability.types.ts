import type { CanonicalJsonSha256Digest } from "@opencrane/util";

export type { CanonicalJsonSha256Digest } from "@opencrane/util";

/** Public P-256 key registered to one verified workload assignment. */
export interface Es256PublicJwk
{
	/** JSON Web Key type required by the live workload binding. */
	readonly kty: "EC";
	/** Named curve required by the runtime binding authority. */
	readonly crv: "P-256";
	/** Base64url-encoded affine x-coordinate. */
	readonly x: string;
	/** Base64url-encoded affine y-coordinate. */
	readonly y: string;
}

/** Immutable reference to a published capability catalog revision. */
export interface CapabilityCatalogReference
{
	/** Stable catalog identifier. */
	catalogId: string;
	/** Positive, monotonically increasing catalog revision. */
	revision: number;
	/** Digest binding the reference to the exact catalog payload. */
	digest: CanonicalJsonSha256Digest;
}

/** Reference to one capability in an immutable catalog revision. */
export interface CapabilityReference
{
	/** Immutable catalog revision that defines the capability. */
	catalog: CapabilityCatalogReference;
	/** Stable capability identifier inside the referenced catalog. */
	capabilityId: string;
}
