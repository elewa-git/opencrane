import type { KubernetesObject } from "@kubernetes/client-node";

import type { TenantSpec } from "./tenant-spec.types.js";
import type { TenantStatus } from "./tenant-status.interface.js";

/** Full Tenant custom resource with typed desired and observed state. */
export interface Tenant extends KubernetesObject
{
  /** Desired state of the tenant. */
  spec: TenantSpec;

  /** Observed state of the tenant, managed by the operator. */
  status?: TenantStatus;
}
