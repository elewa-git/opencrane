import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { accessTokensRouter } from "@opencrane/domain/access-tokens";
import { aiBudgetRouter, tokenUsageRouter, spendRouter } from "@opencrane/domain/spend";
import { auditRouter } from "@opencrane/domain/audit";
import { groupsRouter } from "@opencrane/domain/groups";
import { _RegisterInternalBundles, skillCatalogRouter, skillModelPostureRouter, OciBundleStore } from "@opencrane/domain/skills";
import { _RegisterInternalTenantContract } from "@opencrane/domain/contract";
import { _RegisterInternalTenantModels, modelRoutingDefaultsRouter, modelRoutingRecommendationsRouter, modelRoutingMetricsRouter, routingEvalCasesRouter, routingMeasurementsRouter, routingProposalsRouter, _BuildShadowSeams } from "@opencrane/domain/model-routing";
import { _RegisterInternalParticipation, awarenessRolloutRouter, awarenessParticipationRouter } from "@opencrane/domain/awareness";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/domain/mcp";
import { metricsRouter, prometheusMetricsRouter } from "@opencrane/domain/metrics";
import { policiesRouter } from "@opencrane/domain/policies";
import { providerKeysRouter, providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/domain/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/domain/grants";
import { tenantsRouter } from "@opencrane/domain/tenants";
import { thirdPartySourcesRouter } from "@opencrane/domain/retrieval";
import { _BuildGatewayAdmin } from "@opencrane/domain/connections";
import { _BuildCultureMergeEngine, cultureDocsRouter } from "@opencrane/domain/org-culture-propagation";
import { sessionsRouter } from "@opencrane/domain/sessions";
import { _CheckDbHealth, _OpenapiRouter } from "@opencrane/infra/http";
import { spec } from "../openapi/spec.js";

/**
 * Build the optional OCI (Zot) skill-bundle store from the environment.
 *
 * Returns null when `SKILL_OCI_REGISTRY_URL` is unset, in which case skill delivery
 * serves DB `content` only (today's behaviour). When set, publish dual-writes to the
 * store and delivery reads from it first, falling back to DB content (P4D.2 cutover).
 */
function _BuildOciBundleStore(): OciBundleStore | null
{
  const registryUrl = process.env.SKILL_OCI_REGISTRY_URL?.trim();
  if (!registryUrl)
  {
    return null;
  }
  return new OciBundleStore({ registryUrl, repository: process.env.SKILL_OCI_REPOSITORY?.trim() || "skills" });
}

/**
 * Registers all API routes on the given Express application instance.
 * All business routes are namespaced under /api/v1/.
 * Infrastructure routes (/healthz, /prom) remain at the root.
 *
 * @param app       - Express application to register routes on.
 * @param prisma    - Prisma ORM client for database access in route handlers.
 * @param customApi - Kubernetes Custom Objects API client for tenant and policy management.
 * @param coreApi   - Kubernetes Core V1 API client for AI budget management.
 * @param authApi   - Kubernetes Authentication API for tenant contract TokenReview validation.
 * @returns The Express application instance with registered routes.
 */
/**
 * Mount the internal (`/api/internal/*`) routers. These MUST be registered BEFORE the
 * session `___AuthMiddleware` (see index.ts) — mounting them after it 401s every caller:
 *   - NetworkPolicy-only routes (`bundles`, `tenant-models`) take NO token; access is
 *     enforced at the network layer. The operator fetches `tenant-models` on its own
 *     reconcile hot path with no credential, so behind session auth it 401s → the model
 *     set is always null → replace-mode pods brick with an empty allowlist.
 *   - pod-identity routes (`contract`, `participation`) run their OWN TokenReview over a
 *     projected pod token, which the browser-session middleware cannot satisfy.
 * @see apps/clustertenant-platform/templates/networkpolicy-planes.yaml — the runtime-plane policies.
 */
export function _RegisterInternalRoutes(app: Express, prisma: PrismaClient, authApi: k8s.AuthenticationV1Api): void
{
  // Optional OCI store for skill-bundle content (P4D.2); null → DB-only delivery.
  const ociBundleStore = _BuildOciBundleStore();
  app.use("/api/internal/bundles", _RegisterInternalBundles(prisma, ociBundleStore));
  // NetworkPolicy-only (no auth/TokenReview): the operator fetches a tenant's
  // allowed model set + effective default at reconcile. Best-effort — never 404/500.
  app.use("/api/internal/tenant-models", _RegisterInternalTenantModels(prisma));
  // Note: /api/internal/contract enforces per-tenant identity via TokenReview — not NetworkPolicy-only.
  app.use("/api/internal/contract", _RegisterInternalTenantContract(prisma, authApi));
  app.use("/api/internal/awareness/participation", _RegisterInternalParticipation(prisma, authApi));
}

/**
 * Mount every session-gated `/api/v1/*` domain router on the app.
 *
 * The internal (`/api/internal/*`) routers are mounted separately by
 * `_RegisterInternalRoutes` (before `___AuthMiddleware`) and must not be
 * re-mounted here.
 *
 * @param app       - The Express application.
 * @param prisma    - Prisma client for persistence.
 * @param customApi - Kubernetes custom-objects API client.
 * @param coreApi   - Kubernetes core API client.
 * @param authApi   - Kubernetes authentication API client.
 * @returns The same app, with routers mounted.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, authApi: k8s.AuthenticationV1Api): Express
{
  // NOTE: the internal (`/api/internal/*`) routers are mounted separately by
  // `_RegisterInternalRoutes`, which index.ts calls BEFORE `___AuthMiddleware` so the
  // operator's tokenless reconcile fetch + the pod-identity TokenReview routes are not
  // gated by the browser-session auth. Do NOT re-mount them here.
  // Optional OCI store for skill-bundle content (P4D.2); null → DB-only delivery.
  const ociBundleStore = _BuildOciBundleStore();

  // Gateway admin for the connection kill-switch (CONN.5); no-op until a
  // control-plane operator device is paired (CONN.4 — needs live infra).
  const gatewayAdmin = _BuildGatewayAdmin();

  app.use("/api/v1/metrics", metricsRouter(customApi, prisma));
  app.use("/api/v1/audit", auditRouter(prisma));
  app.use("/api/v1/tenants", tenantsRouter(customApi, prisma, coreApi, gatewayAdmin));
  app.use("/api/v1/policies", policiesRouter(customApi, prisma));
  app.use("/api/v1/ai-budget", aiBudgetRouter(coreApi, prisma));
  app.use("/api/v1/token-usage", tokenUsageRouter(prisma));
  app.use("/api/v1/groups", groupsRouter(prisma));
  app.use("/api/v1/mcp-servers", mcpServersRouter(prisma));
  app.use("/api/v1/mcp", mcpOperatorRouter(prisma));
  app.use("/api/v1/shares", sharesRouter(prisma));
  app.use("/api/v1/resource-shares", resourceSharesRouter(prisma));
  app.use("/api/v1/skills/catalog", skillCatalogRouter(prisma, ociBundleStore));
  app.use("/api/v1/skills/posture", skillModelPostureRouter(prisma));
  app.use("/api/v1/model-routing/defaults", modelRoutingDefaultsRouter(prisma));
  app.use("/api/v1/model-routing/eval-cases", routingEvalCasesRouter(prisma));
  app.use("/api/v1/model-routing/measurements", routingMeasurementsRouter(prisma, _BuildShadowSeams));
  app.use("/api/v1/model-routing/proposals", routingProposalsRouter(prisma));
  app.use("/api/v1/model-routing/recommendations", modelRoutingRecommendationsRouter(prisma));
  app.use("/api/v1/model-routing/metrics", modelRoutingMetricsRouter(prisma));
  app.use("/api/v1/third-party-sources", thirdPartySourcesRouter(prisma));
  app.use("/api/v1/org/culture-docs", cultureDocsRouter(prisma, _BuildCultureMergeEngine()));
  // NOTE: the fleet / super-admin surfaces — ClusterTenant lifecycle, billing accounts, org
  // membership, platform DNS, and Zitadel administration — have moved to the cluster-wide
  // fleet-manager (Stage 4). The silo keeps ClusterTenant + OrgMembership as local READ-MODELS
  // (for per-org login + the org-admin gate) but no longer SERVES their management API.
  app.use("/api/v1/awareness/rollout", awarenessRolloutRouter(prisma));
  app.use("/api/v1/awareness/participation", awarenessParticipationRouter(prisma));
  app.use("/api/v1/sessions", sessionsRouter(prisma));
  app.use("/api/v1/spend", spendRouter(prisma));
  app.use("/api/v1/access-tokens", accessTokensRouter(prisma));
  app.use("/api/v1/providers/keys", providerKeysRouter(prisma));
  app.use("/api/v1/providers/credentials", providerCredentialsRouter(prisma));
  // BYOK raw-key path — writes the silo's provider key Secret in the operator's own namespace
  // (POD_NAMESPACE, downward-API populated; "default" fallback mirrors config._readOwnNamespace).
  app.use("/api/v1/providers/byok", providerByokRouter(prisma, coreApi, process.env.POD_NAMESPACE?.trim() || "default"));
  app.use("/api/v1/models", modelRegistryRouter(prisma));
  app.use("/api/v1/openapi.json", _OpenapiRouter(spec));
  app.get("/healthz", _CheckDbHealth(prisma));
  app.use("/prom", prometheusMetricsRouter(prisma, customApi));
  return app;
}
