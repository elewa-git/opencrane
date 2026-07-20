import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { CLUSTER_TENANT_CRD_PLURAL, OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, _IsK8sNotFound, type ClusterTenantResource } from "@opencrane/server/_infra/api";

import type { SeedOwnClusterTenantOptions, SeedOwnClusterTenantResult } from "./seed-own-cluster-tenant.types.js";

export type { SeedOwnClusterTenantOptions, SeedOwnClusterTenantResult };

/**
 * Standalone ClusterTenant self-seed (#151 item 4): create THIS silo's own cluster-scoped
 * ClusterTenant CR and immediately bind it to `namespace` — the one action a genuinely
 * standalone silo has no external fleet to perform (in every other topology the fleet-manager
 * is the sole authority that creates a ClusterTenant CR and drives its `status.boundNamespace`
 * / `phase` — see `opencrane.fleetManagerRbacRules` in the chart and
 * `_ResolveOwnClusterTenant`'s discovery contract).
 *
 * Idempotent and recovery-safe:
 *  - a CR already named `opts.name` is left untouched (even if unbound — a human/script may be
 *    mid-provisioning it by hand; this seed never overwrites an existing spec);
 *  - a CR already bound to `namespace` under any other name is treated as already-seeded;
 *  - only creates + binds when BOTH are absent.
 *
 * Best-effort: every failure is logged and swallowed so a hiccup here never blocks the
 * TenantOperator / PolicyOperator / idle-checker from starting (mirrors every other boot-time
 * seed in this module).
 *
 * @param customApi - Custom objects client (cluster-scoped ClusterTenant create + status patch).
 * @param namespace - The silo's own namespace — becomes `status.boundNamespace`.
 * @param opts - The org identity to seed (name, owner, tier).
 * @param log - Scoped logger.
 */
export async function _SeedOwnClusterTenant(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  opts: SeedOwnClusterTenantOptions,
  log: Logger,
): Promise<SeedOwnClusterTenantResult | null>
{
  const name = opts.name.trim();
  if (!name)
  {
    return null;
  }

  try
  {
    // 1. Already bound (to this namespace or another) → nothing to do. Cheaper than a
    //    by-name get, and covers the "seeded under a different name" recovery case.
    const list = await customApi.listClusterCustomObject({
      group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL,
    }) as { items?: ClusterTenantResource[] };
    const alreadyBound = (list.items ?? []).find((ct) => ct.status?.boundNamespace === namespace);
    if (alreadyBound?.metadata?.name)
    {
      log.info({ namespace, name: alreadyBound.metadata.name }, "a ClusterTenant is already bound to this namespace; skipping standalone self-seed");
      return { name: alreadyBound.metadata.name, created: false };
    }

    // 2. The named CR may already exist (created out-of-band, not yet bound) — never
    //    overwrite its spec; just bind it if it's missing status.
    let existing: ClusterTenantResource | null = null;
    try
    {
      existing = await customApi.getClusterCustomObject({
        group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL, name,
      }) as ClusterTenantResource;
    }
    catch (err)
    {
      if (!_IsK8sNotFound(err)) throw err;
    }

    if (!existing)
    {
      const ownerEmail = opts.ownerEmail?.trim();
      const ownerSubject = opts.ownerSubject?.trim() || ownerEmail;
      await customApi.createClusterCustomObject({
        group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL,
        body: {
          apiVersion: `${OPENCRANE_API_GROUP}/${OPENCRANE_API_VERSION}`,
          kind: "ClusterTenant",
          metadata: { name },
          spec: {
            displayName: opts.displayName?.trim() || name,
            isolationTier: opts.tier?.trim() || "shared",
            ...(ownerSubject
              ? { owner: { subject: ownerSubject, ...(ownerEmail ? { email: ownerEmail } : {}) } }
              : {}),
          },
        },
      });
      log.info({ namespace, name }, "standalone self-seed: created own ClusterTenant CR");
    }

    // 3. Bind it (JSON Patch merge on /status, mirroring TenantStatusWriter) — this silo is
    //    its own provisioner, so it is the one that must set boundNamespace/phase here.
    await customApi.patchClusterCustomObjectStatus({
      group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL, name,
      body: [{ op: "add", path: "/status", value: { phase: "ready", boundNamespace: namespace, provisioner: "standalone" } }],
    });
    log.info({ namespace, name }, "standalone self-seed: bound own ClusterTenant to this namespace");

    return { name, created: !existing };
  }
  catch (err)
  {
    log.warn({ err, namespace, name }, "standalone ClusterTenant self-seed failed (non-fatal; retried on next boot / left for manual bootstrap)");
    return null;
  }
}
