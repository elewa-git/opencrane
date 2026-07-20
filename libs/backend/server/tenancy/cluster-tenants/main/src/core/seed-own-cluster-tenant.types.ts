/** Inputs for {@link _SeedOwnClusterTenant}, sourced from the operator's standalone-seed config. */
export interface SeedOwnClusterTenantOptions
{
  /** Stable org name (the ClusterTenant CR name). */
  name: string;
  /** Human-readable display name; falls back to `name` when empty. */
  displayName?: string;
  /** Owner email recorded on `spec.owner.email` — becomes the seeded default Tenant's contact email. */
  ownerEmail?: string;
  /** Optional owner OIDC subject recorded on `spec.owner.subject`; falls back to `ownerEmail`. */
  ownerSubject?: string;
  /** Isolation tier recorded on `spec.isolationTier`; falls back to `"shared"` when empty. */
  tier?: string;
}

/** Outcome of a {@link _SeedOwnClusterTenant} call. */
export interface SeedOwnClusterTenantResult
{
  /** The ClusterTenant CR name that was ensured. */
  name: string;
  /** Whether the CR was created (and bound) on this call, vs. already present. */
  created: boolean;
}
