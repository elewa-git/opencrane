import type * as k8s from "@kubernetes/client-node";

import type { CutTenantParams, CutTenantResult } from "./cut-tenant.types.js";

/**
 * Label selector that matches every pod owned by a tenant.
 * Mirrors `_BuildTenantLabels` in the operator (`opencrane.io/tenant=<name>`).
 */
const TENANT_POD_LABEL = "opencrane.io/tenant";

/**
 * Force-disconnect a tenant by deleting its single-user runtime pod.
 *
 * @param coreApi - Kubernetes Core V1 API client (pod deletion).
 * @param params - Tenant and namespace to cut.
 * @returns A summary confirming the pod was force-deleted.
 */
export async function _CutTenant(coreApi: k8s.CoreV1Api,
                                 params: CutTenantParams): Promise<CutTenantResult>
{
  await coreApi.deleteCollectionNamespacedPod({
    namespace: params.namespace,
    labelSelector: `${TENANT_POD_LABEL}=${params.tenant}`,
  });

  return {
    tenant: params.tenant,
    podForceDeleted: true,
  };
}
