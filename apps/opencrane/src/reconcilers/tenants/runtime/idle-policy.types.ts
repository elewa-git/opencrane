/** Candidate tenant for idle-suspend evaluation. */
export interface IdleCandidate
{
  /** Tenant resource name. */
  name: string;

  /** Tenant namespace. */
  namespace: string;
}
