// OpenTelemetry must be initialised before any instrumented module is imported,
// so this side-effecting import stays first in the file (and is also preloaded
// via NODE_OPTIONS=--import in the container).
import "./app/instrument.js";

import { randomUUID } from "node:crypto";

import * as k8s from "@kubernetes/client-node";

import { pinoHttp } from "pino-http";
import express, { type Express } from "express";
import type { PrismaClient } from "@prisma/client";

import { ___BindConsole, ___GetContext, ___RequestContext, ___ShutdownTelemetry, ___DoWithTrace } from "@opencrane/observability";
import { ___AuthMiddleware } from "@opencrane/infra/auth";
import { _ErrorHandler, _RateLimit } from "@opencrane/infra/http";

import { ___AuthRouter } from "./infra/auth/auth.router.js";
import { ___CreateOidcAuthService } from "./infra/auth/oidc.service.js";
import { ___CreatePrismaClient } from "./infra/db/db.js";
import { _TransportSecurity } from "./infra/middleware/transport-security.middleware.js";
import { _log as log } from "./app/log.js";
import { _RegisterInternalRoutes, _RegisterRoutes } from "./app/routes.js";
import { TenantProjectionRepairer } from "./infra/projection/tenant-projection-repairer.js";
import { MembershipProjectionRepairer, _BuildHttpFleetMembershipReader, _BuildHttpFleetMembershipWriter } from "./infra/projection/membership-projection-repairer.js";
import { _ResolveOwnClusterTenantName, _SeedOwnDefaultTenant, _SeedOwnClusterTenant } from "@opencrane/backend/cluster-tenants";
import { CogneeLiteLlmKey } from "./reconcilers/tenants/internal/cognee-litellm-key.js";
import { CogneeSiloTenant } from "./reconcilers/tenants/internal/cognee-silo-tenant.js";

// In-silo controllers (Stage 5). The silo runs every in-silo reconcile loop over its OWN
// namespace, so a silo stands on its own; the fleet-manager watches only the cluster-scoped
// ClusterTenant CR and nothing inside a silo.
import { _LoadOperatorConfig, type OpenClawTenantOperatorConfig } from "./app/config.js";
import { _ProvisionByokKey } from "@opencrane/backend/model-routing";
import { _CreateTenantOperator, IdleChecker } from "./reconcilers/tenants/index.js";
import { PolicyOperator } from "./reconcilers/policies/operator.js";
import { GatewayProxyServer } from "./gateways/gateway-proxy/server.js";

// Route any stray console.* call (first-party or third-party) through the
// structured logger so nothing reaches stdout unstructured / uncorrelated.
const _unbindConsole = ___BindConsole(log);

/**
 * Creates and configures the Express application with all middleware and routes.
 * Exported for use in tests with injected dependencies.
 * @param prisma    - Prisma ORM client
 * @param customApi - Kubernetes Custom Objects API client
 * @param coreApi   - Kubernetes Core V1 API client
 * @param authApi   - Kubernetes Authentication API for tenant contract TokenReview
 * @returns Configured Express application
 */
export function createApp(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, authApi: k8s.AuthenticationV1Api): Express
{
  const app = express();
  // First-login member workspaces are seeded into the TenantOperator's watch namespace
  // (WATCH_NAMESPACE) — the same target as the owner-default seed — falling back to NAMESPACE
  // then "default" for dev/test. It is deliberately NOT the projection-repair namespace.
  // Member adoption writes THROUGH to the fleet's authoritative membership when FLEET_INTERNAL_URL
  // is set (fleet-managed); the writer is null for a standalone silo, where adoption writes local.
  const authWatchNamespace = process.env.WATCH_NAMESPACE ?? process.env.NAMESPACE ?? "default";
  const authFleetWriter = _BuildHttpFleetMembershipWriter(process.env.FLEET_INTERNAL_URL?.trim() ?? "", process.env.OPENCRANE_API_TOKEN?.trim() ?? "", log);
  const authService = ___CreateOidcAuthService(log, prisma, customApi, authWatchNamespace, authFleetWriter);

  // Middleware
  app.set("trust proxy", 1);
  // Transport security first: HSTS on HTTPS responses + optional HTTP→HTTPS redirect,
  // before any body parsing or session handling.
  app.use(_TransportSecurity());
  app.use(express.json());
  // Per-IP rate limit, before the auth router + routes, so every DB-backed / authz-gated
  // endpoint is covered. Generous cap — a DoS backstop, not a functional limit; /healthz,
  // /readyz, and /api/internal (the high-frequency pod-poll surface) are exempt.
  app.use(_RateLimit());
  // Seed the per-request correlation context BEFORE pino-http so every request
  // log (and every downstream service log) shares one requestId.
  app.use(___RequestContext());
  // ___RequestContext() (mounted above) always seeds the id; the ?? is only a
  // type-level fallback so genReqId never returns undefined.
  app.use(pinoHttp({ logger: log, genReqId: function _genReqId() { return ___GetContext()?.requestId ?? randomUUID(); } }));
  app.use(...authService.createSessionMiddleware());

  // Auth router is mounted before the auth middleware so its endpoints are
  // inherently public — the device-flow activate handler enforces its own
  // session check internally.
  app.use("/api/v1/auth", ___AuthRouter(authService, prisma));

  // NOTE: `/api/internal/*` is NOT on this public listener — it is served by the
  // separate internal app (see `createInternalApp`) on its own port, which the public
  // ingress never routes to. Keeping the tokenless internal routes off the public
  // listener is what stops them being reachable from the internet under the org
  // ingress's `/api` path (they take no auth by design — NetworkPolicy is their gate).

  // Pass prisma so DB-issued access tokens from POST /access-tokens are validated
  // in addition to the env-var token.
  app.use(___AuthMiddleware(prisma));

  // Register API routes
  _RegisterRoutes(app, prisma, customApi, coreApi, authApi);

  // Global error handler — must be registered after all routes.
  app.use(_ErrorHandler(log));

  return app;
}

/**
 * Build the INTERNAL Express app — a second listener serving ONLY the tokenless
 * `/api/internal/*` routes on {@link OpenClawTenantOperatorConfig.internalPort}.
 *
 * This listener is bound to its own port and exposed by a Service port the public
 * ingress never routes to; NetworkPolicy restricts it to platform pods. There is NO
 * session/token auth middleware here by design — the NetworkPolicy-only routes
 * (bundles, tenant-models) authenticate at the network layer and the pod-identity
 * routes (contract, participation) run their own TokenReview. Splitting them onto a
 * separate listener is what keeps them off the internet-facing `/api` surface.
 */
export function createInternalApp(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api): Express
{
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(___RequestContext());
  app.use(pinoHttp({ logger: log, genReqId: function _genReqId() { return ___GetContext()?.requestId ?? randomUUID(); } }));
  _RegisterInternalRoutes(app, prisma, authApi);
  app.use(_ErrorHandler(log));
  return app;
}

/** HTTP port the server listens on. */
const port = Number(process.env.PORT ?? "8080");

// Initialize Prisma
const prisma = ___CreatePrismaClient(log);

// Initialize Kubernetes client
/** Kubernetes configuration loaded from the default context. */
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

/** Kubernetes Custom Objects API client. */
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

/** Kubernetes Core V1 API client. */
const coreApi = kc.makeApiClient(k8s.CoreV1Api);

/** Kubernetes Authentication API client — used for tenant contract TokenReview validation. */
const authApi = kc.makeApiClient(k8s.AuthenticationV1Api);

// Build and start the PUBLIC app (ingress-facing: /api/v1/*, /auth — session-authed).
const app = createApp(prisma, customApi, coreApi, authApi);

log.info({ port }, "starting opencrane control plane");

const server = app.listen(port, function _onListen()
{
  log.info({ port }, "control plane listening");
});

// Build and start the INTERNAL app on a SEPARATE port (/api/internal/* — tokenless,
// NetworkPolicy-gated). Kept off the public listener so the org ingress's `/api` path
// can never reach it from the internet. Same process, distinct socket.
/** Port for the internal-only listener (see config.internalPort). */
const internalPort = Number(process.env.INTERNAL_PORT ?? "8081");
const internalApp = createInternalApp(prisma, authApi);
const internalServer = internalApp.listen(internalPort, function _onInternalListen()
{
  log.info({ internalPort }, "control plane internal API listening");
});

// NOTE: the single-tenant ClusterTenant boot-seed moved to the fleet-manager (Stage 4) — the
// fleet owns the ClusterTenant registry. The silo receives its ClusterTenant read-model via CR
// projection, not a local boot-seed.

// Periodic Tenant-projection repair (Stage 4). The fleet-manager creates each org's
// `<org>-default` Tenant CRD on ready; the silo has no operator watch, so this loop reconciles
// its Postgres projection to the namespace's Tenant CRDs (creating missing rows) so fleet-seeded
// workspaces appear in the silo's management API. Idempotent + fail-soft; interval from
// OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS (default 60; 0 disables).
const _projectionRepairNamespace = process.env.NAMESPACE ?? "default";
const _projectionRepairIntervalMs = Number(process.env.OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS ?? "60") * 1000;
const tenantProjectionRepairer = new TenantProjectionRepairer(customApi, prisma, _projectionRepairNamespace, log, _projectionRepairIntervalMs);
tenantProjectionRepairer.start();

// Periodic fleet → silo OrgMembership projection repair (#126 S2). The fleet registry owns the
// authoritative membership; the silo keeps a local read-model the org-admin gate + POST /tenants
// membership validation (S1) depend on. This loop pulls the org's membership from the fleet
// internal endpoint and reconciles the silo rows. Standalone-safe (#151): when FLEET_INTERNAL_URL
// is unset or the fleet is unreachable, the reader returns null and the sweep no-ops, leaving
// locally-managed rows intact. Interval shares OPENCRANE_PROJECTION_REPAIR_INTERVAL_SECONDS.
/** Reference to the membership repairer, populated once the silo's org name resolves. */
let _membershipRepairerRef: MembershipProjectionRepairer | null = null;
void (async function _startMembershipRepairer()
{
  const clusterTenant = await _ResolveOwnClusterTenantName(customApi, _projectionRepairNamespace, log);
  if (!clusterTenant)
  {
    log.info({ namespace: _projectionRepairNamespace }, "no ClusterTenant bound to this namespace yet; membership projection repairer idle");
    return;
  }
  const fleetInternalUrl = process.env.FLEET_INTERNAL_URL?.trim() ?? "";
  const fleetInternalToken = process.env.OPENCRANE_API_TOKEN?.trim() ?? "";
  const reader = _BuildHttpFleetMembershipReader(fleetInternalUrl, fleetInternalToken, log);
  // Suspension ENFORCEMENT (#126): the sweep cuts a Suspended member's runtime pod and
  // suspends the workspace. Thread the Kubernetes clients + this silo's namespace so
  // the repairer can drive `_CutTenant` and the Tenant `spec.suspended` patch.
  const enforcement = { customApi, coreApi, namespace: _projectionRepairNamespace };
  const repairer = new MembershipProjectionRepairer(prisma, reader, clusterTenant, log, _projectionRepairIntervalMs, enforcement);
  repairer.start();
  _membershipRepairerRef = repairer;
})();

/** Idle-checker handle, set during controller bootstrap for shutdown access. */
let _idleCheckerRef: IdleChecker | null = null;

/** Periodic Cognee silo-tenant heal timer, cleared on shutdown. */
let _cogneeSiloHealTimerRef: ReturnType<typeof setInterval> | null = null;

/** In-process gateway proxy server handle, for graceful shutdown. */
let _gatewayProxyRef: GatewayProxyServer | null = null;

/**
 * Start every in-silo reconcile loop over this silo's OWN namespace (Stage 5).
 *
 * The fleet-manager stops at ClusterTenant lifecycle; the silo owns the tenant runtime:
 * the TenantOperator (openclaw pods/ConfigMaps/Services + LiteLLM keys), the PolicyOperator
 * (AccessPolicy → NetworkPolicy), the idle-suspend checker, the runtime-plane drift repairer,
 * and the identity-routing gateway proxy — all scoped to `config.watchNamespace` (this silo's
 * namespace). Because the operator
 * is DB-less, its internal-API calls hit the silo's OWN API (its own Service), so a silo is
 * self-contained.
 *
 * Fail-soft: a controller bootstrap error is logged but never crashes the pod — the silo's
 * management API + health endpoint stay up so the misconfiguration is diagnosable rather than
 * crash-looping.
 */
/**
 * Optional boot-time bootstrap of this silo's OpenAI BYOK key, gated on the
 * `OPENCRANE_BOOTSTRAP_OPENAI_KEY` env var (injected from a deploy Secret — never hardcoded). When
 * set, provisions it as the silo's Global OpenAI key via the same path as the BYOK route: writes the
 * encrypted Secret, registers the LiteLLM credential, and seeds a default model. Idempotent (upsert)
 * so re-running on every boot is safe, and best-effort so a hiccup never blocks controller startup.
 *
 * Intended for short-lived testing: populate the deploy Secret to light a silo up, then delete it to
 * stop re-applying (the live key is removed via the BYOK delete endpoint / Model Keys UI, not by
 * clearing the env). The raw key is never logged.
 *
 * @param config - Operator config; supplies the operator's own namespace for the Secret write.
 */
async function _BootstrapProviderKeyIfConfigured(config: OpenClawTenantOperatorConfig): Promise<void>
{
  const apiKey = process.env.OPENCRANE_BOOTSTRAP_OPENAI_KEY?.trim();
  if (!apiKey)
  {
    return;
  }

  try
  {
    const result = await _ProvisionByokKey({ prisma, coreApi, operatorNamespace: config.operatorNamespace, provider: "openai", apiKey, log });
    log.info({ provider: "openai", litellmRegistered: result.litellmRegistered }, "bootstrap provider key provisioned for silo");
  }
  catch (err)
  {
    log.warn({ err }, "bootstrap provider key provisioning failed; continuing boot");
  }
}

async function _startInSiloControllers(): Promise<void>
{
  try
  {
    const config = _LoadOperatorConfig();
    log.info({ watchNamespace: config.watchNamespace }, "starting in-silo controllers");

    // Optional test bootstrap — provision this silo's OpenAI BYOK key from an injected env var
    // (sourced from a deploy Secret), BEFORE the default-tenant seed so the model it seeds satisfies
    // the seed's ≥1-model onboarding gate and the silo comes up usable. Awaited for that ordering.
    await _BootstrapProviderKeyIfConfigured(config);

    const tenantOperator = _CreateTenantOperator(kc, config, log);

    // Standalone-only boot seeds (#151 item 4): a fleet-managed silo defers ClusterTenant
    // lifecycle AND its own default-workspace seed entirely to the external fleet-manager +
    // its provisioning flow (member adoption / first login) — this silo racing an unconditional
    // create here could seed a workspace ahead of / independent from the fleet's authoritative
    // membership state. A standalone silo has no such fleet, so it is both the one that must
    // create + bind its own ClusterTenant CR (see `_SeedOwnClusterTenant`) and the one that
    // seeds its own first workspace once that CR resolves.
    if (config.deploymentMode === "standalone")
    {
      void (async function _standaloneBootSeeds()
      {
        if (config.standaloneSeedName.trim())
        {
          await _SeedOwnClusterTenant(customApi, config.watchNamespace, {
            name: config.standaloneSeedName,
            displayName: config.standaloneSeedDisplayName,
            ownerEmail: config.standaloneSeedOwnerEmail,
            ownerSubject: config.standaloneSeedOwnerSubject,
            tier: config.standaloneSeedTier,
          }, log);
        }

        // Seed this silo's own `<org>-default` workspace Tenant from its ClusterTenant CR
        // owner. Use config.watchNamespace (the namespace the operators below reconcile in)
        // so the seed lands where the TenantOperator will pick it up — not the
        // projection-repair namespace, which is derived independently and could diverge
        // under manual env overrides. Run AFTER the ClusterTenant self-seed above so a
        // fresh standalone boot has something bound to seed a workspace from.
        const seedResult = await _SeedOwnDefaultTenant(customApi, prisma, config.watchNamespace, log);
        if (seedResult?.created)
        {
          try
          {
            await tenantOperator.reconcileExistingTenantByName(seedResult.tenantName, config.watchNamespace);
            log.info({ tenantName: seedResult.tenantName }, "queued standalone default tenant for immediate reconciliation");
          }
          catch (err)
          {
            log.warn({ err, tenantName: seedResult.tenantName }, "standalone default tenant immediate reconcile failed; watch replay remains the backstop");
          }
        }
      })();
    }
    else
    {
      log.info({ deploymentMode: config.deploymentMode }, "fleet-managed silo: skipping standalone boot seeds (ClusterTenant lifecycle + default-workspace seed are the external fleet's)");
    }

    // Ensure this silo's Cognee has its own dedicated LiteLLM virtual key — a SEPARATE
    // identity/budget from tenant chat spend (Cognee's embedding + graph-extraction calls
    // must be trackable on their own, not folded into a tenant's cap). One-shot at boot:
    // there is exactly one Cognee per silo and its params rarely change, unlike per-tenant
    // keys which reconcile every tenant-CR poll. Best-effort — a LiteLLM outage at boot
    // must not block the tenant/policy operators from starting.
    void (async function _ensureCogneeLiteLlmKey()
    {
      const clusterTenantName = await _ResolveOwnClusterTenantName(customApi, config.watchNamespace, log);
      if (!clusterTenantName)
      {
        log.info({ namespace: config.watchNamespace }, "no ClusterTenant bound to this namespace yet; cognee litellm key provisioning idle");
        return;
      }
      const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc);
      const cogneeAppsApi = kc.makeApiClient(k8s.AppsV1Api);
      try
      {
        await new CogneeLiteLlmKey(config, coreApi, objectApi, cogneeAppsApi, log).ensureCogneeLiteLlmKeySecret(clusterTenantName, config.watchNamespace);
      }
      catch (err)
      {
        log.warn({ err, clusterTenantName }, "cognee litellm key provisioning failed; cognee will run without embedding/LLM credentials until this is retried");
      }

      // Ensure this silo has ONE Cognee owner account + Cognee Tenant — the grouping every
      // per-openclaw-tenant Cognee login (CogneeTenantIdentity) joins so the plugin's
      // companyDataset scope is actually shared silo-wide instead of a private dataset per
      // tenant (see CogneeSiloTenant's doc comment). Independent try/catch: this has no
      // dependency on the LiteLLM key above other than running after it in this same IIFE;
      // a failure here must not affect that key already having been provisioned.
      try
      {
        await new CogneeSiloTenant(config, coreApi, objectApi, log).ensureSiloTenant(clusterTenantName, config.watchNamespace);
      }
      catch (err)
      {
        log.warn({ err, clusterTenantName }, "cognee silo tenant provisioning failed; per-tenant logins will join it once this is retried");
      }
    })();

    // Periodic Cognee silo-tenant heal. The boot attempt above is one-shot, but the silo owner +
    // Cognee Tenant live in Cognee's OWN database (unlike the LiteLLM key, a durable k8s Secret) —
    // a Cognee restart onto a fresh/empty store (notably the FIRST mount of its new persistent
    // volume) wipes them, and the single boot attempt misses that window whenever Cognee isn't
    // ready at exactly that moment (it usually restarts alongside this pod on a deploy). Without a
    // live owner, EVERY per-tenant `ensureTenantJoinedToSiloTenant` fails at owner-login and the
    // tenant stays 401 forever. Re-running on a slow cadence closes that gap: `ensureSiloTenant`
    // is idempotent + liveness-checked (a cheap no-op once the owner authenticates) and
    // re-provisions when it was wiped. Slow interval — this is a silo singleton that changes rarely.
    if (config.cogneeEndpoint)
    {
      const cogneeSiloHealer = new CogneeSiloTenant(config, coreApi, k8s.KubernetesObjectApi.makeApiClient(kc), log);
      _cogneeSiloHealTimerRef = setInterval(function _healCogneeSiloTenant()
      {
        void (async function _run()
        {
          try
          {
            const ctName = await _ResolveOwnClusterTenantName(customApi, config.watchNamespace, log);
            if (!ctName)
            {
              return;
            }
            await cogneeSiloHealer.ensureSiloTenant(ctName, config.watchNamespace);
          }
          catch (err)
          {
            log.warn({ err }, "cognee silo-tenant heal tick failed; will retry next interval");
          }
        })();
      }, 60_000);
    }

    const policyOperator = new PolicyOperator(kc, config, log);

    const idleChecker = new IdleChecker(kc, config, log);
    _idleCheckerRef = idleChecker;
    idleChecker.start();

    // In-process identity-routing gateway proxy (DOMAIN.T4): serves the gateway WebSocket,
    // delegates auth to the silo control plane, injects X-Forwarded-User, reverse-proxies to
    // the user's pod. Holds no Kubernetes client and no secrets.
    if (config.gatewayProxyEnabled)
    {
      const gatewayProxy = new GatewayProxyServer({
        port: config.gatewayProxyPort,
        // The proxy calls GET /api/v1/auth/gateway-resolve — a PUBLIC route on the public
        // listener (same pod), so it targets localhost:<public port>, NOT the internal listener.
        controlPlaneUrl: `http://localhost:${port}`,
        gatewayPort: config.gatewayPort,
        clusterDomain: config.clusterDomain,
        userHeader: config.gatewayTrustedProxyUserHeader,
        allowedOrigins: config.gatewayProxyAllowedOrigins,
        allowedOriginBaseDomains: config.gatewayProxyAllowedOriginBaseDomains,
        rateLimitPerMinute: config.gatewayProxyRateLimitPerMinute,
      }, log);
      gatewayProxy.start();
      _gatewayProxyRef = gatewayProxy;
    }
    else
    {
      log.info("in-silo gateway proxy disabled (GATEWAY_PROXY_ENABLED not true)");
    }

    // Start the watch loops concurrently — these reconcile Tenant + AccessPolicy CRs in the
    // silo's own namespace.
    await Promise.all([tenantOperator.start(), policyOperator.start()]);
  }
  catch (err)
  {
    log.error({ err }, "in-silo controller bootstrap failed; the silo API stays up but the tenant runtime is NOT reconciling");
  }
}

void _startInSiloControllers();

/**
 * Gracefully drain the server, disconnect Prisma, flush telemetry, and restore
 * console before exiting. A hard-exit timer guards against a stuck close so the
 * pod terminates within the kubelet grace period.
 * @param signal - The signal that triggered shutdown.
 */
async function _shutdown(signal: string): Promise<void>
{
  log.info({ signal }, "shutting down control plane");

  // 1. Force exit if graceful shutdown stalls, so we never exceed the grace period.
  const hardExit = setTimeout(function _force() { process.exit(1); }, 10_000);
  hardExit.unref();

  // Stop the projection-repair loops + in-silo controllers so no sweep races the disconnect below.
  tenantProjectionRepairer.stop();
  _membershipRepairerRef?.stop();
  if (_cogneeSiloHealTimerRef)
  {
    clearInterval(_cogneeSiloHealTimerRef);
  }
  _idleCheckerRef?.stop();
  await _gatewayProxyRef?.stop();

  try
  {
    // 2. Stop accepting new connections and let in-flight requests finish — both listeners.
    await Promise.all([
      new Promise<void>(function _close(resolve) { server.close(function _done() { resolve(); }); }),
      new Promise<void>(function _closeInternal(resolve) { internalServer.close(function _done() { resolve(); }); }),
    ]);
    // 3. Release the DB pool so Postgres connections aren't leaked.
    await prisma.$disconnect();
    // 4. Flush any buffered spans to the collector before the process dies.
    await ___ShutdownTelemetry();
  }
  catch (err)
  {
    log.error({ err }, "error during graceful shutdown");
  }
  finally
  {
    // 5. Restore the original console methods last, then exit cleanly.
    _unbindConsole();
    process.exit(0);
  }
}

process.on("SIGTERM", function _onSigterm() { void _shutdown("SIGTERM"); });
process.on("SIGINT", function _onSigint() { void _shutdown("SIGINT"); });
