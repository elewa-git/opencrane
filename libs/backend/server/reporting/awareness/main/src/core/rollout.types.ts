/**
 * Fleet awareness contract rollout state (P4B.3).
 *
 * `targetVersion` is promoted across `waves` (narrow→wide canary order) via the
 * advancing `promotedWaves` frontier; un-promoted waves keep `stableVersion`.
 */
export interface AwarenessRolloutState
{
  /** The contract version being rolled out to promoted waves. */
  targetVersion: string;
  /** The contract version un-promoted waves continue to run. */
  stableVersion: string;
  /** Ordered canary waves (narrow→wide). */
  waves: string[];
  /** Waves promoted to the target so far (the rollout frontier). */
  promotedWaves: string[];
  /** When true, promoted waves resolve the target but still serve stable (shadow). */
  shadowMode: boolean;
}

/** The awareness contract version resolved for a single tenant. */
export interface ResolvedAwarenessVersion
{
  /** The contract version the tenant should run. */
  version: string;
  /** Whether the tenant's wave has been promoted to the target. */
  promoted: boolean;
  /** Whether the tenant is in shadow mode (computes target, still serves stable). */
  shadow: boolean;
  /** The wave the tenant resolved to. */
  wave: string;
}
