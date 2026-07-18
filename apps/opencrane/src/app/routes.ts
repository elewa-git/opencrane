import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { accessTokensRouter } from "@opencrane/backend/access-tokens";
import { aiBudgetRouter, tokenUsageRouter, spendRouter } from "@opencrane/backend/spend";
import { auditRouter } from "@opencrane/backend/audit";
import { groupsRouter } from "@opencrane/backend/groups";
import { _RegisterInternalBundles, skillCatalogRouter, skillModelPostureRouter, OciBundleStore } from "@opencrane/backend/skills";
import { _RegisterInternalTenantContract } from "@opencrane/backend/contract";
import { _RegisterInternalTenantModels, modelRoutingDefaultsRouter, modelRoutingRecommendationsRouter, modelRoutingMetricsRouter, routingEvalCasesRouter, routingMeasurementsRouter, routingProposalsRouter, _BuildShadowSeams } from "@opencrane/backend/model-routing";
import { _RegisterInternalParticipation, awarenessRolloutRouter, awarenessParticipationRouter } from "@opencrane/backend/awareness";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/backend/mcp";
import { metricsRouter, prometheusMetricsRouter } from "@opencrane/backend/metrics";
import { policiesRouter } from "@opencrane/backend/policies";
import { providerKeysRouter, providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/backend/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/backend/grants";
import { tenantsRouter } from "@opencrane/backend/tenants";
import { thirdPartySourcesRouter } from "@opencrane/backend/retrieval";
import { _BuildDocMergeReconciler, companyDocsRouter } from "@opencrane/backend/company-docs";
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
 * @see apps/opencrane-infra/templates/networkpolicy-planes.yaml — the runtime-plane policies.
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
 * Mount authenticated public API and infrastructure routes.
 *
 * @param app - Express application to register routes on.
 * @param prisma - Prisma client used by route handlers.
 * @param customApi - Kubernetes custom objects client.
 * @param coreApi - Kubernetes core API client.
 * @param authApi - Kubernetes authentication API client.
 * @returns The configured Express application.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, authApi: k8s.AuthenticationV1Api): Express
{
  // NOTE: the internal (`/api/internal/*`) routers are mounted separately by
  // `_RegisterInternalRoutes`, which index.ts calls BEFORE `___AuthMiddleware` so the
  // operator's tokenless reconcile fetch + the pod-identity TokenReview routes are not
  // gated by the browser-session auth. Do NOT re-mount them here.
  // Optional OCI store for skill-bundle content (P4D.2); null → DB-only delivery.
  const ociBundleStore = _BuildOciBundleStore();

  app.use("/api/v1/metrics", metricsRouter(customApi, prisma));
  app.use("/api/v1/audit", auditRouter(prisma));
  app.use("/api/v1/tenants", tenantsRouter(customApi, prisma, coreApi));
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
  app.use("/api/v1/org/workspace-docs", companyDocsRouter(prisma, _BuildDocMergeReconciler()));
  // NOTE: the fleet / super-admin surfaces — ClusterTenant lifecycle, billing accounts, org
  // membership, platform DNS, and Zitadel administration — have moved to the cluster-wide
  // fleet-manager (Stage 4). The silo keeps ClusterTenant + OrgMembership as local READ-MODELS
  // (for per-org login + the org-admin gate) but no longer SERVES their management API.
  app.use("/api/v1/awareness/rollout", awarenessRolloutRouter(prisma));
  app.use("/api/v1/awareness/participation", awarenessParticipationRouter(prisma));
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
