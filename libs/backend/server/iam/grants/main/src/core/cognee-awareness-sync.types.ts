/** A compiled awareness grant decision in the shape pushed to Cognee. */
export interface CogneeAwarenessGrant
{
  /** The awareness payload identifier the decision applies to. */
  payloadId: string;
  /** Effective access after precedence resolution. */
  access: "allow" | "deny";
  /** Organizational scope of the winning grant (org/department/project/personal). */
  scope: string;
}

/**
 * Transport that pushes a tenant's compiled awareness grants to Cognee, where
 * the retrieval ACL is enforced. Injectable so the compile→push orchestration is
 * unit-testable without a live Cognee. Throws on a non-2xx Cognee response.
 */
export type CogneeGrantTransport = (tenant: string, grants: CogneeAwarenessGrant[], authorization: string | undefined) => Promise<void>;

/** Outcome of syncing one tenant's awareness grants to Cognee. */
export interface AwarenessGrantSyncResult
{
  /** Tenant whose grants were synced. */
  tenant: string;
  /** Number of allow decisions pushed. */
  allowed: number;
  /** Number of deny decisions pushed. */
  denied: number;
  /** Whether the push succeeded. */
  ok: boolean;
  /** Failure detail when `ok` is false. */
  error?: string;
}

/** Outcome of propagating an AccessPolicy change to Cognee for affected tenants. */
export interface PolicyPropagationResult
{
  /** The policy whose change triggered propagation. */
  policy: string;
  /** Tenants the policy resolved to (DB-resolvable selector matches). */
  tenants: string[];
  /** Per-tenant sync results. */
  results: AwarenessGrantSyncResult[];
  /** Number of tenants whose sync failed (best-effort; never blocks the write). */
  failures: number;
}
