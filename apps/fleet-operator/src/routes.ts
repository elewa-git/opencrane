import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";

import { _CheckDbHealth, _OpenapiRouter } from "@opencrane/infra-http";

import type { PrismaClient } from "./generated/prisma/index.js";
import { spec } from "./openapi/spec.js";
import { _BuildClusterTenantProvisionerRegistry } from "./core/cluster-tenants/registry.js";
import { _BuildZitadelManagementClient } from "./infra/zitadel/zitadel-client.js";
import { _BuildZitadelKeySecretStore } from "./infra/zitadel/key-secret-store.js";
import { clusterTenantsRouter } from "./routes/cluster-tenants.js";
import { clusterTenantMembersRouter } from "./routes/cluster-tenant-members.js";
import { _RegisterInternalClusterTenantMembers } from "./routes/internal/cluster-tenant-members.js";
import { billingAccountsRouter } from "./routes/billing-accounts.js";
import { platformDnsRouter } from "./routes/platform-dns.js";
import { zitadelKeyRouter } from "./routes/admin/zitadel-key.js";
import { zitadelReconcileRouter } from "./routes/admin/zitadel-reconcile.js";

/**
 * Read a boolean feature flag from the environment, defaulting ON.
 *
 * The fleet plane's self-service surfaces (ClusterTenant lifecycle, billing) are ON unless
 * an install explicitly disables them (`OPENCRANE_CLUSTER_TENANT_MANAGER_ENABLED=false`,
 * `OPENCRANE_BILLING_ENABLED=false`). Defaulting ON keeps a configured fleet install fully
 * functional without extra flags; only an explicit `false`/`0`/`off`/`no` disables a feature.
 *
 * @param name - The environment variable name.
 * @returns True unless the variable is explicitly set to a falsey token.
 */
function _featureEnabled(name: string): boolean
{
  const raw = process.env[name]?.trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

/**
 * Register the fleet-manager HTTP routes on the given Express app.
 *
 * The fleet plane is the cluster-wide super-admin surface: ClusterTenant lifecycle, billing,
 * org membership, platform DNS, and Zitadel administration — all against the fleet registry DB
 * and the one Zitadel instance the fleet-manager (sole IAM_OWNER holder) provisions orgs on.
 *
 * @param app       - Express application to register routes on.
 * @param prisma    - Fleet registry Prisma client used by the route handlers.
 * @param customApi - Kubernetes Custom Objects API (ClusterTenant CR bridge, platform DNS).
 * @param coreApi   - Kubernetes Core V1 API (platform DNS creds Secret, Zitadel key Secret).
 * @returns The Express application with routes registered.
 */
export function _RegisterFleetRoutes(
  app: Express,
  prisma: PrismaClient,
  customApi: k8s.CustomObjectsApi,
  coreApi: k8s.CoreV1Api,
): Express
{
  // ClusterTenant lifecycle + Zitadel admin + platform DNS — the super-admin / org-management
  // surface. Gated so a fleet install can be stood up without it; Zitadel is a hard dependency
  // of this path, built (and only built) here so an install without it never requires Zitadel.
  if (_featureEnabled("OPENCRANE_CLUSTER_TENANT_MANAGER_ENABLED"))
  {
    const registry = _BuildClusterTenantProvisionerRegistry();
    const zitadelClient = _BuildZitadelManagementClient();

    // Platform DNS is a fleet/platform-admin surface (provisions the cert-manager DNS-01
    // issuer + creds Secret for the wildcard tenant cert).
    app.use("/api/v1/platform/dns", platformDnsRouter(customApi, coreApi));

    app.use("/api/v1/cluster-tenants", clusterTenantsRouter(prisma, registry, customApi, zitadelClient));
    // Org membership registry mounted under the parent org's `:name` (mergeParams).
    // Shares the live Zitadel client so a member upsert seats the member's project role.
    app.use("/api/v1/cluster-tenants/:name/members", clusterTenantMembersRouter(prisma, zitadelClient));
    // Internal (fleet ↔ silo) membership seam — the silo repairer pulls org membership from
    // here (GET) and writes through member adoptions on first login (POST .../adopt). Bearer-
    // token + NetworkPolicy gated; shares the live Zitadel client so an adoption seats the
    // member's project role. Auth'd by the same middleware, off the public versioned surface.
    app.use("/api/internal/cluster-tenants", _RegisterInternalClusterTenantMembers(prisma, zitadelClient));

    // Superadmin-gated rotation of the platform's Zitadel SA key (the master IdP credential),
    // and idempotent reconcile/backfill of half-provisioned orgs — both on the same live client.
    app.use("/api/v1/admin/zitadel", zitadelKeyRouter(zitadelClient, _BuildZitadelKeySecretStore(coreApi)));
    app.use("/api/v1/admin/zitadel", zitadelReconcileRouter(prisma, zitadelClient));
  }

  // Fleet-level billing: seats are ordered centrally and the fleet notifies the silo of
  // approved seats. Gated so a fleet install without billing can omit the surface.
  if (_featureEnabled("OPENCRANE_BILLING_ENABLED"))
  {
    app.use("/api/v1/billing-accounts", billingAccountsRouter(prisma));
  }

  // Public OpenAPI contract document for the fleet plane (no auth — bypassed by the middleware).
  app.use("/api/v1/openapi.json", _OpenapiRouter(spec));

  app.get("/healthz", _CheckDbHealth(prisma));
  return app;
}
