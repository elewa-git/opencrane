/**
 * Resolves one server-owned runtime profile for a durable AgentService workload-profile key.
 *
 * Images are accepted only as immutable OCI digests. The controller never chooses these
 * coordinates, and a missing or malformed profile simply prevents assignment.
 *
 * @param workloadProfile - Persisted AgentService profile key.
 * @param profiles - Product configuration indexed by the accepted profile key.
 * @returns Validated runtime coordinates, or null when no safe profile is configured.
 */
export function __ResolveControllerRuntimeProfile(workloadProfile: string, profiles: ReadonlyMap<string, { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number }>): { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number } | null
{
	const profile = profiles.get(workloadProfile);
	if (profile === undefined) return null;
	if (!_dnsLabel(profile.namespace) || !_dnsLabel(profile.serviceAccountName)) return null;
	if (!/^.+@sha256:[a-f0-9]{64}$/u.test(profile.image)) return null;
	if (!Number.isSafeInteger(profile.assignmentTtlMs) || profile.assignmentTtlMs < 60_000 || profile.assignmentTtlMs > 300_000) return null;
	return profile;
}

/** Returns whether a Kubernetes namespace or ServiceAccount name is a conservative DNS label. */
function _dnsLabel(value: string): boolean
{
	return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) && value.length <= 63;
}
