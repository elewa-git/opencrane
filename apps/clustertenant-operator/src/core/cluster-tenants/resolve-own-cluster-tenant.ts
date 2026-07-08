import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { CLUSTER_TENANT_CRD_PLURAL, OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, type ClusterTenantResource } from "@opencrane/infra-api";

/**
 * Resolve WHICH org (ClusterTenant) this silo serves: the cluster-scoped ClusterTenant CR
 * whose `status.boundNamespace` is this silo's namespace. This is the single discovery
 * implementation — the boot-time default-tenant seed and the membership projection loops
 * both consume it. Returns the full CR (callers pick the fields they need), or null when
 * no ClusterTenant is bound to the namespace yet.
 *
 * Best-effort: a read error is logged and returns null rather than throwing, so a caller on
 * the boot path degrades gracefully.
 *
 * @param customApi - Custom objects client (cluster-scoped ClusterTenant read).
 * @param namespace - The silo's own namespace (the bound namespace to match on).
 * @param log       - Scoped logger.
 * @returns The bound org's CR, or null when none is bound / on read error.
 */
export async function _ResolveOwnClusterTenant(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  log: Logger,
): Promise<ClusterTenantResource | null>
{
  try
  {
    const list = await customApi.listClusterCustomObject({
      group: OPENCRANE_API_GROUP,
      version: OPENCRANE_API_VERSION,
      plural: CLUSTER_TENANT_CRD_PLURAL,
    }) as { items?: ClusterTenantResource[] };

    return (list.items ?? []).find((ct) => ct.status?.boundNamespace === namespace) ?? null;
  }
  catch (err)
  {
    log.warn({ err, namespace }, "failed to resolve own ClusterTenant; org-scoped loops will idle until resolvable");
    return null;
  }
}

/**
 * Name-only convenience over {@link _ResolveOwnClusterTenant} for callers that key purely
 * on the org name (e.g. the membership projection repairer).
 */
export async function _ResolveOwnClusterTenantName(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  log: Logger,
): Promise<string | null>
{
  const own = await _ResolveOwnClusterTenant(customApi, namespace, log);
  return own?.metadata?.name ?? null;
}
