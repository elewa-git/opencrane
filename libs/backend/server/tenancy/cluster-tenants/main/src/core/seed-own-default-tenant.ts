import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { _EnsureOwnerDefaultTenant } from "./default-tenant.js";
import type { EnsureDefaultTenantResult } from "./default-tenant.types.js";
import { _ResolveOwnClusterTenant } from "./resolve-own-cluster-tenant.js";

/**
 * Seed the silo's own `<org>-default` workspace Tenant on boot (Stage 5).
 *
 * Called ONLY in standalone mode (#151 item 4 — see the `deploymentMode` gate around this
 * call in `index.ts`): a standalone silo has no fleet-side create to wait on, so it seeds
 * its own first workspace itself. In fleet-managed mode the external fleet's own
 * provisioning flow (member adoption / first login) is authoritative instead — this call is
 * skipped there so a boot-time seed can never race ahead of / diverge from the fleet's
 * membership state. It discovers WHICH org it serves via {@link _ResolveOwnClusterTenant}
 * (the single boundNamespace-discovery implementation — populated by `_SeedOwnClusterTenant`
 * on a fresh standalone boot), then dual-writes the `<org>-default` Tenant (CRD + DB row) via
 * {@link _EnsureOwnerDefaultTenant}; the silo's own TenantOperator reconciles the CRD into a
 * running openclaw.
 *
 * Best-effort and idempotent: a missing CR, an unbound namespace, an owner without a
 * verified email, or any read error is logged and skipped — never fatal. The periodic
 * {@link TenantProjectionRepairer} remains the backstop once the org is ready.
 *
 * @param customApi - Custom objects client (cluster-scoped ClusterTenant read).
 * @param prisma    - Silo Prisma client (the workspace projection row).
 * @param namespace - The silo's own namespace (the bound namespace to match on).
 * @param log       - Scoped logger.
 */
export async function _SeedOwnDefaultTenant(
  customApi: k8s.CustomObjectsApi,
  prisma: PrismaClient,
  namespace: string,
  log: Logger,
): Promise<EnsureDefaultTenantResult | null>
{
  try
  {
    const own = await _ResolveOwnClusterTenant(customApi, namespace, log);
    if (!own?.metadata?.name)
    {
      log.info({ namespace }, "no ClusterTenant bound to this namespace yet; skipping default-tenant seed");
      return null;
    }

    const orgName = own.metadata.name;
    const result = await _EnsureOwnerDefaultTenant({
      customApi,
      prisma,
      namespace,
      orgName,
      orgDisplayName: own.spec.displayName ?? orgName,
      ownerEmail: own.spec.owner?.email,
      ownerSubject: own.spec.owner?.subject,
    });

    if (result.created)
    {
      log.info({ orgName, tenantName: result.tenantName }, "seeded own default workspace tenant on boot");
    }
    else
    {
      log.info({ orgName, tenantName: result.tenantName, skippedReason: result.skippedReason }, "default workspace tenant already present or skipped");
    }

    return result;
  }
  catch (err)
  {
    log.warn({ err, namespace }, "default-tenant boot seed failed (non-fatal; projection-repair remains the backstop)");
    return null;
  }
}
