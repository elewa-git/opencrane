/** Request body to define (or redefine) the awareness rollout (P4B.3). */
export interface SetRolloutRequest
{
  /** The contract version to roll out. */
  targetVersion: string;
  /** The fallback version for un-promoted waves; defaults to the SDK's pinned version. */
  stableVersion?: string;
  /** Ordered canary waves (narrow→wide); defaults to personal→project→department→org. */
  waves?: string[];
  /** Whether promoted waves run in shadow mode (compute target, serve stable). */
  shadowMode?: boolean;
}

/** Request body to advance the rollout frontier. */
export interface PromoteRolloutRequest
{
  /** Promote up to and including this wave; omit to advance one wave. */
  wave?: string;
}
