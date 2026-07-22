import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { aiBudgetRouter, tokenUsageRouter, spendRouter } from "@opencrane/backend/server/reporting/spend";
import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { _RegisterInternalTenantContract } from "@opencrane/backend/server/tenancy/contract";
import { _RegisterInternalTenantModels, modelRoutingDefaultsRouter, modelRoutingMetricsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { _RegisterInternalParticipation, awarenessRolloutRouter, awarenessParticipationRouter } from "@opencrane/backend/server/reporting/awareness";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/backend/server/gateways/mcp";
import { metricsRouter, prometheusMetricsRouter } from "@opencrane/backend/server/reporting/metrics";
import { policiesRouter } from "@opencrane/backend/server/iam/policies";
import { providerKeysRouter, providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/backend/server/gateways/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/backend/server/iam/grants";
import { tenantsRouter } from "@opencrane/backend/server/tenancy/tenants";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { _BuildDocMergeReconciler, companyDocsRouter } from "@opencrane/backend/server/knowledge/company-docs";
import { _CheckDbHealth, _OpenapiRouter } from "@opencrane/server/_infra/http";
import { _RegisterInternalAgentRuntimeStream, type RuntimeTokenReviewer, type RuntimeWorkloadIdentity } from "@opencrane/server/_infra/agent-runtime-stream";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import { spec } from "@opencrane/backend/server/api-spec";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AgentControllerTokenReviewer, type ReviewedAgentControllerIdentity } from "@opencrane/backend/agents/personal/runs";
import { PrismaRuntimeDispatchAuthority } from "@opencrane/backend/agents/runtime";
import { PrismaRuntimeBootstrapExchange, __CreateRuntimeBootstrapRouter } from "@opencrane/backend/server/iam/authorization";
import { ___DoWithTrace } from "@opencrane/observability";

import { _log } from "./log.js";

/** Read a bounded, server-owned seconds setting and return milliseconds. */
function _ReadBoundedSeconds(name: string, fallbackSeconds: number, minimumSeconds: number, maximumSeconds: number): number
{
	const raw = process.env[name]?.trim();
	if (!raw) return fallbackSeconds * 1_000;
	const seconds = Number(raw);
	if (!Number.isSafeInteger(seconds) || seconds < minimumSeconds || seconds > maximumSeconds) throw new Error(`${name} must be an integer from ${minimumSeconds} through ${maximumSeconds}`);
	return seconds * 1_000;
}

/** Read a bounded, server-owned integer setting without applying time-unit conversion. */
function _ReadBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}

/** Return whether one value is a bounded Kubernetes namespace DNS label. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/**
 * Read the server and runtime namespaces as one fail-closed deployment boundary.
 * The runtime namespace is explicit because it identifies untrusted workload subjects and durable
 * assignments; it must never silently collapse back into the OpenCrane server namespace.
 */
function _ReadRuntimeNamespaceBoundary(): { readonly serverNamespace: string; readonly runtimeNamespace: string }
{
	const serverNamespace = process.env.POD_NAMESPACE?.trim() || "default";
	const runtimeNamespace = process.env.AGENT_RUNTIME_NAMESPACE?.trim();
	if (!_IsNamespace(serverNamespace) || !runtimeNamespace || !_IsNamespace(runtimeNamespace) || runtimeNamespace === serverNamespace)
	{
		throw new Error("AGENT_RUNTIME_NAMESPACE must be a valid namespace different from POD_NAMESPACE");
	}
	return { serverNamespace, runtimeNamespace };
}

/**
 * Convert one reviewed Kubernetes subject into the identity accepted by the runtime transport.
 *
 * The expected namespace comes from server-owned deployment configuration. The reviewed
 * ServiceAccount must satisfy the same bounded runtime-profile grammar used when building Jobs, and
 * the Pod UID must come from TokenReview. Returning `null` on every mismatch keeps subject parsing
 * from silently broadening which runtime workloads the server trusts.
 */
function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null): RuntimeWorkloadIdentity | null
{
  const parts = subject.split(":");
	const serviceAccountName = parts[3];
	if (parts.length !== 4 || parts[0] !== "system" || parts[1] !== "serviceaccount" || parts[2] !== expectedNamespace || !serviceAccountName || !___IsAgentRuntimeServiceAccountName(serviceAccountName) || !podUid)
  {
    return null;
  }
	return { subject, namespace: expectedNamespace, serviceAccountName, podUid };
}

/**
 * Read the Pod UID claim Kubernetes attaches to a bound projected ServiceAccount token.
 *
 * The UID is required because a ServiceAccount name identifies a workload class, not the exact Pod
 * assigned to one run attempt. Missing or malformed TokenReview extras therefore fail closed.
 */
function _ReadReviewedPodUid(extra: Record<string, string[]> | undefined): string | null
{
	const podUid = extra?.["authentication.kubernetes.io/pod-uid"]?.[0];
	return typeof podUid === "string" && podUid.length > 0 ? podUid : null;
}

/**
 * Submit one audience-bound projected token and expose only an authenticated accepted review.
 *
 * The raw credential remains local to this traced Kubernetes call. A valid signature without the
 * exact requested audience is collapsed into the same denial as any other failed TokenReview.
 */
async function _ReviewProjectedToken(authApi: k8s.AuthenticationV1Api, token: string, audience: string): Promise<k8s.V1TokenReviewStatus | null>
{
	return ___DoWithTrace("kubernetes.projected_token.review", { audience }, async function _reviewToken(): Promise<k8s.V1TokenReviewStatus | null>
	{
		const body = new k8s.V1TokenReview();
		body.spec = new k8s.V1TokenReviewSpec();
		body.spec.token = token;
		body.spec.audiences = [audience];
		const review = await authApi.createTokenReview({ body });
		const status = review.status;
		return status?.authenticated && status.audiences?.includes(audience) ? status : null;
	});
}

/**
 * Build the app-owned Kubernetes TokenReview adapter for runtime projected credentials.
 *
 * Kubernetes remains the issuer and verifier. This adapter fixes the audience and namespace, then
 * validates the reviewed ServiceAccount against the shared runtime-profile grammar and exposes only
 * the workload identity needed by the transport. It never forwards the raw token or TokenReview
 * response; a valid signature without all bindings is still unauthorised.
 */
function _CreateRuntimeTokenReviewer(authApi: k8s.AuthenticationV1Api, runtimeNamespace: string): RuntimeTokenReviewer
{
  return {
    async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
    {
		const status = await _ReviewProjectedToken(authApi, token, AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE);
		if (!status) return null;
		return _ParseRuntimeSubject(status.user?.username ?? "", runtimeNamespace, _ReadReviewedPodUid(status.user?.extra));
    },
  };
}

/**
 * Parse only the fixed agent-controller ServiceAccount subject in one silo namespace.
 * A valid token for any other namespaced identity must never inherit controller dispatch authority.
 */
function _ParseAgentControllerSubject(username: string, expectedNamespace: string, audiences: readonly string[]): ReviewedAgentControllerIdentity | null
{
	const expectedUsername = `system:serviceaccount:${expectedNamespace}:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`;
	if (username !== expectedUsername) return null;
	return { username, namespace: expectedNamespace, serviceAccountName: AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, audiences };
}

/**
 * Build the app-owned TokenReview adapter for the sole agent-controller identity.
 * The adapter fixes audience, namespace, and ServiceAccount before exposing a reviewed identity to
 * the run-dispatch router; no caller-provided coordinate can widen those bindings.
 */
function _CreateAgentControllerTokenReviewer(authApi: k8s.AuthenticationV1Api, serverNamespace: string): AgentControllerTokenReviewer
{
	return {
		async __Review(token: string): Promise<ReviewedAgentControllerIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE);
			return status ? _ParseAgentControllerSubject(status.user?.username ?? "", serverNamespace, status.audiences ?? []) : null;
		},
	};
}

/**
 * Mount the internal (`/api/internal/*`) routers. These MUST be registered BEFORE the
 * session `___AuthMiddleware` (see index.ts) — mounting them after it 401s every caller:
 *   - The NetworkPolicy-only `tenant-models` route takes no token; access is
 *     enforced at the network layer. The operator fetches `tenant-models` on its own
 *     reconcile hot path with no credential, so behind session auth it 401s → the model
 *     set is always null → replace-mode pods brick with an empty allowlist.
 *   - pod-identity routes (`contract`, `participation`) run their OWN TokenReview over a
 *     projected pod token, which the browser-session middleware cannot satisfy.
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — the runtime-plane policies.
 */
export function _RegisterInternalRoutes(app: Express, prisma: PrismaClient, authApi: k8s.AuthenticationV1Api): void
{
	const { serverNamespace, runtimeNamespace } = _ReadRuntimeNamespaceBoundary();
	const claimLeaseMilliseconds = _ReadBoundedSeconds("AGENT_CONTROLLER_CLAIM_LEASE_SECONDS", 30, 1, 300);
	const assignmentTtlMilliseconds = _ReadBoundedSeconds("AGENT_RUNTIME_ASSIGNMENT_TTL_SECONDS", 3_600, 60, 86_400);
	const publishedOutboxRetentionMilliseconds = _ReadBoundedSeconds("AGENT_RUNTIME_OUTBOX_RETENTION_SECONDS", 604_800, 3_600, 7_776_000);
	const outboxPruneBatchSize = _ReadBoundedInteger("AGENT_RUNTIME_OUTBOX_PRUNE_BATCH_SIZE", 100, 1, 1_000);
	const commandTtlMilliseconds = _ReadBoundedSeconds("AGENT_RUNTIME_COMMAND_TTL_SECONDS", 60, 1, 300);
	const runDispatchRepository = new PrismaRunDispatchRepository(prisma, { namespace: runtimeNamespace, claimLeaseMilliseconds, assignmentTtlMilliseconds, publishedOutboxRetentionMilliseconds, outboxPruneBatchSize });
	const runtimeTokenReviewer = _CreateRuntimeTokenReviewer(authApi, runtimeNamespace);
	const runtimeDispatchAuthority = new PrismaRuntimeDispatchAuthority(prisma, { namespace: runtimeNamespace, commandTtlMilliseconds });
	app.use("/api/internal/agent-controller", __CreateAgentControllerRunDispatchRouter({ tokenReviewer: _CreateAgentControllerTokenReviewer(authApi, serverNamespace), namespace: serverNamespace, repository: runDispatchRepository, logger: _log }));
  // NetworkPolicy-only (no auth/TokenReview): the operator fetches a tenant's
  // allowed model set + effective default at reconcile. Best-effort — never 404/500.
  app.use("/api/internal/tenant-models", _RegisterInternalTenantModels(prisma));
  // Note: /api/internal/contract enforces per-tenant identity via TokenReview — not NetworkPolicy-only.
  app.use("/api/internal/contract", _RegisterInternalTenantContract(prisma, authApi));
  app.use("/api/internal/awareness/participation", _RegisterInternalParticipation(prisma, authApi));
  // The runtime opens this internal SSE connection itself and performs its one-use bootstrap
  // exchange here. TokenReview is the identity boundary for both routers; the durable dispatch
  // authority mints fenced commands and admits candidates, and the bootstrap router binds the
  // runtime's public proof key exactly once. Both are mounted under the same base path.
  app.use("/api/internal/agent-runtime", __CreateRuntimeBootstrapRouter({
    tokenReviewer: runtimeTokenReviewer,
    namespace: runtimeNamespace,
    repository: new PrismaRuntimeBootstrapExchange(prisma),
    clock: { nowEpochMs(): number { return Date.now(); } },
    logger: _log,
  }));
  app.use("/api/internal/agent-runtime", _RegisterInternalAgentRuntimeStream({
    tokenReviewer: runtimeTokenReviewer,
    authority: runtimeDispatchAuthority,
    maxBodyBytes: 64 * 1024,
    heartbeatMilliseconds: 15_000,
    commandPollMilliseconds: 1_000,
  }));
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
  app.use("/api/v1/model-routing/defaults", modelRoutingDefaultsRouter(prisma));
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
