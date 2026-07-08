import * as k8s from "@kubernetes/client-node";

import { OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, TENANT_CRD_PLURAL } from "@opencrane/infra-api";

/**
 * Set (or clear) a Tenant CR's `spec.suspended` flag via a JSON merge-patch — the shared
 * suspend/resume patch the tenants route (`POST /:name/suspend|/resume`) and the membership
 * projection repairer (#126) both drive, so the patch shape stays consistent between them. The
 * TenantOperator watches this flag and scales a suspended tenant's Deployment to zero (and back).
 * (The idle-checker's auto-suspend still holds its own inline copy — a candidate follow-up dedup.)
 *
 * A merge-patch touches only `spec.suspended`, leaving the rest of the spec untouched, so it is
 * safe to re-apply idempotently (a no-op when the flag is already at the target value). It does
 * NOT delete the pod — suspension keeps the workspace, it does not tear it down.
 *
 * @param customApi - Kubernetes Custom Objects API client.
 * @param namespace - Namespace the Tenant CR lives in.
 * @param name      - Tenant CR name.
 * @param suspended - Target value for `spec.suspended` (true ⇒ suspend, false ⇒ resume).
 */
export async function _SetTenantSuspended(customApi: k8s.CustomObjectsApi, namespace: string, name: string, suspended: boolean): Promise<void>
{
  await customApi.patchNamespacedCustomObject({
    group: OPENCRANE_API_GROUP,
    version: OPENCRANE_API_VERSION,
    namespace,
    plural: TENANT_CRD_PLURAL,
    name,
    body: { spec: { suspended } },
  }, k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch));
}
