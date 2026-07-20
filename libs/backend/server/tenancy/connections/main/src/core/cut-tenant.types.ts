/** Parameters for force-disconnecting a tenant runtime. */
export interface CutTenantParams
{
  /** Tenant whose connections are being cut. */
  tenant: string;
  /** Namespace the tenant pod runs in. */
  namespace: string;
  /** Free-text reason recorded for audit. */
  reason?: string;
}

/** Outcome of a tenant cut. */
export interface CutTenantResult
{
  /** Tenant that was cut. */
  tenant: string;
  /** Whether the tenant pod was force-deleted. */
  podForceDeleted: boolean;
}
