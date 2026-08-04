import { __SignArtifactReadLease } from "@opencrane/backend/artifacts/authorization";

import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader.js";

/** Exact claims signed into a short-lived server-only artifact read lease. */
type ArtifactReadLeaseClaims = Parameters<typeof __SignArtifactReadLease>[0];

/**
 * Build a server-only signer for immutable artifact read leases.
 *
 * The private key remains in the OpenCrane server process, so workload-facing
 * brokers can proxy bytes without ever revealing an ArtifactStore capability.
 * @param environment - Startup configuration containing the mounted key path.
 * @returns A signer that stamps the current epoch time at lease issuance.
 */
export function _CreateArtifactReadLeaseSigner(environment: NodeJS.ProcessEnv = process.env): (claims: ArtifactReadLeaseClaims) => string
{
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	return function _SignReadLease(claims: ArtifactReadLeaseClaims): string { return __SignArtifactReadLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); };
}
