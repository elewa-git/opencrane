// OpenTelemetry must be initialised before any instrumented module is imported,
// so this side-effecting import stays first in the file (and is also preloaded
// via NODE_OPTIONS=--import in the container).
import "./app/instrument.js";

import { randomUUID } from "node:crypto";

import * as k8s from "@kubernetes/client-node";

import { pinoHttp } from "pino-http";
import express, { type Express } from "express";
import type { PrismaClient } from "@prisma/client";

import { ___BindConsole, ___GetContext, ___RequestContext, ___ShutdownTelemetry } from "@opencrane/observability";
import { ___AuthMiddleware } from "@opencrane/server/_infra/auth";
import { _ErrorHandler, _RateLimit, _TransportSecurity } from "@opencrane/server/_infra/http";

import { ___AuthRouter, ___CreateOidcAuthService } from "@opencrane/backend/server/iam/identity";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import { ___CreatePrismaClient } from "./infra/db/db.js";
import { _CreateArtifactUploadGateway } from "./infra/artifacts/artifact-upload.factory.js";
import { _log as log } from "./app/log.js";
import { _RegisterInternalRoutes, _RegisterRoutes } from "./app/routes.js";
import { _CreateManagedRunAdmissionPort, _ReadRunAdmissionConcurrencyPolicy } from "./app/run-admission-wiring.js";
import { _CreateScheduleTicker } from "./app/scheduler-wiring.js";
import { OpenClawTenantLifecycle } from "@opencrane/backend/feat-openclaw-tenant";

// In-silo controllers (Stage 5). The silo runs every in-silo reconcile loop over its OWN
// namespace, so a silo stands on its own; the fleet-manager watches only the cluster-scoped
// ClusterTenant CR and nothing inside a silo.
import { _LoadOperatorConfig } from "./app/config.js";
import { _BuildHostingAdapter } from "./hosting/index.js";

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
 * @param runAdmission - Process-shared, capacity-bounded managed run admission port.
 * @returns Configured Express application
 */
export function createApp(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, authApi: k8s.AuthenticationV1Api, runAdmission: ManagedRunAdmissionPort): Express
{
  const app = express();
  // First-login member workspaces are seeded into the TenantOperator's watch namespace
  // (WATCH_NAMESPACE) — the same target as the owner-default seed — falling back to NAMESPACE
  // then "default" for dev/test. It is deliberately NOT the projection-repair namespace.
  const authWatchNamespace = process.env.WATCH_NAMESPACE ?? process.env.NAMESPACE ?? "default";
  const authService = ___CreateOidcAuthService(log, prisma, customApi, authWatchNamespace);

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

  app.use(___AuthMiddleware());

  // Register API routes
  _RegisterRoutes(app, prisma, customApi, coreApi, authApi, runAdmission);

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
  // The runtime route has a smaller fixed body boundary than other internal routes. Mount
  // it before the generic parser because Express will not re-parse an already consumed body.
  app.use("/api/internal/agent-runtime", express.json({ limit: 64 * 1024, strict: true }));
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
// The runtime proof boundary supplies only already-verified upload commands to this gateway.
// Keeping the app composition here means no runtime pod, route adapter, or byte service can
// construct its own catalog authority or key material.
const artifactUploadGateway = _CreateArtifactUploadGateway(prisma);

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

/** One process-wide capacity boundary shared by run-now and scheduled managed admissions. */
const managedRunAdmission = _CreateManagedRunAdmissionPort(prisma, _ReadRunAdmissionConcurrencyPolicy());

// Build and start the PUBLIC app (ingress-facing: /api/v1/*, /auth — session-authed).
const app = createApp(prisma, customApi, coreApi, authApi, managedRunAdmission);
app.locals.artifactUploadGateway = artifactUploadGateway;

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

// Managed-agent scheduler, composed INSIDE this control-API process (no new workload; same KSA and
// privilege). Each tick evaluates enabled schedules and admits due slots through the existing
// run-admission path. It is off by default: enabling a live periodic tick is part of the
// harvesting-central-agent live-Obot proof gated under #337. The interval is unref'd so it never
// holds the process open, and it is cleared on shutdown.
/** Managed-agent schedule ticker bound to canonical Postgres and the shared admission port. */
const scheduleTicker = _CreateScheduleTicker(prisma, managedRunAdmission);
/** Milliseconds between schedule passes when the scheduler is enabled. */
const schedulerIntervalMs = Math.max(1_000, Number(process.env.OPENCRANE_SCHEDULER_INTERVAL_MS ?? "60000"));
const schedulerHandle = process.env.OPENCRANE_SCHEDULER_ENABLED === "true"
  ? setInterval(function _tick() { void scheduleTicker.runOnce(new Date()).catch(function _onError(err: unknown) { log.error({ err }, "managed-agent schedule tick failed"); }); }, schedulerIntervalMs)
  : null;
schedulerHandle?.unref();

/** Frozen-blue OpenClaw tenant runtime composed behind its library lifecycle contract. */
const openClawTenantLifecycle = new OpenClawTenantLifecycle({
  kubeConfig: kc,
  customApi,
  coreApi,
  prisma,
  publicPort: port,
  loadConfig: _LoadOperatorConfig,
  buildHostingAdapter: _BuildHostingAdapter,
  log,
});
void openClawTenantLifecycle.start();

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

  // Stop the schedule ticker and the in-silo controller before disconnecting their DB dependencies.
  if (schedulerHandle !== null) clearInterval(schedulerHandle);
  await openClawTenantLifecycle.stop();

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
