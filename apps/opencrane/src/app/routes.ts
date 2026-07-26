import type { Express } from "express";
import * as k8s from "@kubernetes/client-node";
import { ActionExecutionState, AgentServiceKind, type Prisma, type PrismaClient } from "@prisma/client";

import { aiBudgetRouter, tokenUsageRouter, spendRouter } from "@opencrane/backend/server/reporting/spend";
import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { _RegisterInternalTenantContract } from "@opencrane/backend/server/tenancy/contract";
import { _IssueAttemptLiteLlmKey, _RegisterInternalTenantModels, modelRoutingDefaultsRouter, modelRoutingMetricsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { _RegisterInternalParticipation, awarenessRolloutRouter, awarenessParticipationRouter } from "@opencrane/backend/server/reporting/awareness";
import { mcpOperatorRouter, mcpServersRouter } from "@opencrane/backend/server/gateways/mcp";
import { metricsRouter, prometheusMetricsRouter } from "@opencrane/backend/server/reporting/metrics";
import { policiesRouter } from "@opencrane/backend/server/iam/policies";
import { providerCredentialsRouter, providerByokRouter, modelRegistryRouter } from "@opencrane/backend/server/gateways/providers";
import { resourceSharesRouter, sharesRouter } from "@opencrane/backend/server/iam/grants";
import { tenantsRouter } from "@opencrane/backend/server/tenancy/tenants";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { _BuildDocMergeReconciler, companyDocsRouter } from "@opencrane/backend/server/knowledge/company-docs";
import { _CheckDbHealth, _OpenapiRouter } from "@opencrane/server/_infra/http";
import { _CreateRuntimeTokenReviewer, _RegisterInternalAgentRuntimeStream } from "@opencrane/server/_infra/agent-runtime-stream";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, type RunInputSnapshot } from "@opencrane/contracts";
import { spec } from "@opencrane/backend/server/api-spec";
import { PrismaRunDispatchRepository, __CreateAgentControllerRunDispatchRouter, type AgentControllerTokenReviewer, type AttemptModelKeyMintRequest, type MintedAttemptModelKey, type ReviewedAgentControllerIdentity } from "@opencrane/backend/agents/execution/runs";
import { PrismaSkillAuthoringCompletionRepository, PrismaSkillAuthoringInputRepository, PrismaSkillWorkloadBootstrapRepository, PrismaSkillWorkloadClaimsRepository, __CreateSkillAuthoringCompletionRouter, __CreateSkillAuthoringInputRouter, __CreateSkillWorkloadBootstrapRouter, __CreateSkillWorkloadDispatchRouter, type SkillWorkloadBootstrapIdentity, type SkillWorkloadBootstrapTokenReviewer } from "@opencrane/backend/agents/skills/execution";
import { __CreateExternalActionExecutor, __CreatePrismaRunInputCompiler, PrismaRuntimeDispatchAuthority, __ExecuteExternalAction, type RunInputCompiler, type RuntimeExternalActionRunner } from "@opencrane/backend/agents/execution/protocol";
import { __IsUpgradeSessionAvailable, PrismaPersonalConfigurationChangeRepository, UPGRADE_SESSION_TOOL, UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { __AppendCompiledTool } from "@opencrane/backend/agents/runtime/prompt-compiler";
import { PrismaRuntimeBootstrapExchange, PrismaToolInvocationRepository, __CreateRuntimeBootstrapRouter, __DeferToolRequest } from "@opencrane/backend/server/iam/authorization";
import { __UnavailableObotCustodyAdapter } from "@opencrane/server/_infra/obot-custody";
import { __UnavailableSandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import { __UnavailableMemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import { __CreateConversationReplayRouter, PrismaConversationReplayRepository } from "@opencrane/backend/server/agents/conversation-replay";
import { PrismaChannelTargetAuthorityRepository } from "@opencrane/backend/server/agents/channel-targets";
import { ___DoWithTrace } from "@opencrane/observability";

import { _CreateAgentServicesRouter } from "./agent-services-wiring.js";
import { _CreateSkillAuthoringArtifactReader } from "../infra/artifacts/artifact-upload.factory.js";
import { _CreatePersonaOnboardingRouter } from "./persona-onboarding-wiring.js";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
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

/** Read a bounded server-owned whole-number setting without converting it into a duration. */
function _ReadBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}

/** Read the controller-registered route identity, leaving replay unreachable until it is configured. */
function _ReadChannelReplayRouteId(): string | null
{
	const routeId = process.env.CHANNEL_REPLAY_ROUTE_ID?.trim();
	return routeId || null;
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

/** Build the TokenReview adapter for a worker identity chosen only by durable bootstrap authority. */
function _CreateSkillWorkloadTokenReviewer(authApi: k8s.AuthenticationV1Api): SkillWorkloadBootstrapTokenReviewer
{
	return {
		async __Review(token: string, audience: string): Promise<SkillWorkloadBootstrapIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, audience);
			const username = status?.user?.username ?? "";
			const match = /^system:serviceaccount:([a-z0-9]([-a-z0-9]*[a-z0-9])?):([a-z0-9]([-a-z0-9]*[a-z0-9])?)$/.exec(username);
			const podUid = status?.user?.extra?.["authentication.kubernetes.io/pod-uid"]?.[0];
			return match && podUid ? { namespace: match[1], serviceAccountName: match[3], podUid } : null;
		},
	};
}

/**
 * Mint one attempt-scoped LiteLLM virtual key for a claimed run attempt.
 *
 * This binds the run-dispatch repository's injected issuer to the model-routing gateway, which holds
 * the LiteLLM master key. Keeping the call here (not in the `scope:execution-runs` library) is why the
 * master key never reaches the outbound-only controller: only the minted virtual key rides the claim
 * response. The per-silo server already targets its own silo LiteLLM, so `siloId` needs no routing.
 * @param request - Alias, single model alias, silo, budget, and expiry the key is bound to.
 * @returns The transient minted key value.
 */
async function _IssueAttemptModelKey(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
{
	const minted = await _IssueAttemptLiteLlmKey({ keyAlias: request.keyAlias, modelAlias: request.modelAlias, maxBudgetUsd: request.maxBudgetUsd, expirySeconds: request.expirySeconds });
	return { key: minted.key };
}

/**
 * Assemble the composition-root external-action runner from the concrete transports.
 *
 * This is where the MCP (Obot custody), sandbox, and memory transports are bound to the pure
 * `__ExecuteExternalAction` boundary and the durable {@link PrismaToolInvocationRepository}, so no
 * `scope:agent-runtime` or `scope:authorization` package imports a transport. Every transport is its
 * fail-closed default until a real one is verified, so an admitted action reserves its invocation and
 * then fails closed rather than fabricating a tool result.
 *
 * @param prisma - Canonical product-authority client backing the tool-invocation receipts.
 * @returns A runner the dispatch authority invokes for each admitted external-action candidate.
 */
function _CreateExternalActionRunner(prisma: PrismaClient): RuntimeExternalActionRunner
{
	const repository = new PrismaToolInvocationRepository(prisma);
	const personalConfiguration = new PrismaPersonalConfigurationChangeRepository(prisma);
	const obotCustody = new __UnavailableObotCustodyAdapter();
	const sandboxExecutor = new __UnavailableSandboxJobExecutor();
	const memoryGateway = new __UnavailableMemoryGatewayClient();
	return {
		async run(candidate, snapshot, compiledTools)
		{
			// The approval requirement is per-tool, derived from the resolved compiled tool grant.
			const tool = compiledTools.find(function _match(definition) { return definition.toolRevisionId === candidate.toolRevisionId; });
			const approvalRequired = tool?.requiresApproval ?? false;
			let executor;
			try
			{
				executor = candidate.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION
					? { execute: function _proposeUpgradeSession() { return personalConfiguration.proposeUpgradeSession(candidate, snapshot, new Date().toISOString()); } }
					: __CreateExternalActionExecutor(candidate, { siloId: snapshot.siloId, subjectId: snapshot.identitySnapshot.executionSubjectId, cogneeDatasetId: _PersonalMemoryDatasetId(snapshot), obotCustody, sandboxExecutor, memoryGateway });
			}
			catch (error)
			{
				return { outcome: "retryable" as const, error };
			}
			const result = await __ExecuteExternalAction(repository, { candidate, snapshot, compiledTools, approvalRequired }, executor);
			if (result.outcome === "denied") return { outcome: "denied" as const };
			// A deferred invocation opens the pending approval that gates the eventual resume.
			if (result.outcome === "deferred")
			{
				const deferred = await _OpenDeferredToolApproval(prisma, repository, candidate, snapshot.capabilitySetDigest, result.reservationId);
				return { outcome: deferred ? "completed" as const : "denied" as const };
			}
			return { outcome: "completed" as const };
		},
	};
}

/** Returns the personal Cognee dataset frozen in a snapshot, or null for every other scope. */
function _PersonalMemoryDatasetId(snapshot: RunInputSnapshot): string | null
{
	const policy = snapshot.memoryQueryPolicy;
	if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return null;
	const record = policy as Readonly<Record<string, unknown>>;
	if (record["scope"] !== "personal") return null;
	const candidate = record["cogneeDatasetId"];
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

/** Compile normal grants, then add the sealed first-party upgrade intent only to personal sessions. */
function _CreatePersonalRunInputCompiler(): RunInputCompiler
{
	const compile = __CreatePrismaRunInputCompiler();
	return async function _compilePersonalInput(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient)
	{
		// 1. Compile the immutable snapshot normally before composition adds any built-in descriptor.
		const input = await compile(snapshot, transaction);
		// 2. Exclude non-conversation and non-persona snapshots without inferring a personal service.
		if (!__IsUpgradeSessionAvailable(snapshot)) return input;
		// 3. Prove the current service kind in the same compiler transaction; snapshot fields alone are insufficient.
		const service = await transaction.agentService.findFirst({ where: { id: snapshot.agentServiceId, siloId: snapshot.siloId, kind: AgentServiceKind.Personal }, select: { id: true } });
		// 4. Append and re-seal only the proven first-party tool, preserving the immutable snapshot itself.
		return service === null ? input : __AppendCompiledTool(input, UPGRADE_SESSION_TOOL);
	};
}

/** Open an approval or terminally fail its already-reserved invocation without allowing a replay. */
async function _OpenDeferredToolApproval(prisma: PrismaClient, repository: PrismaToolInvocationRepository, candidate: { readonly runId: string; readonly attempt: number; readonly toolInvocationId: string; readonly toolRevisionId: string; readonly argumentsDigest: string }, capabilitySetDigest: string, reservationId: string): Promise<boolean>
{
	const expiresAt = new Date(Date.now() + _DEFERRED_APPROVAL_TTL_MILLISECONDS);
	try
	{
		return await prisma.$transaction(async function _defer(transaction): Promise<boolean>
		{
			const result = await __DeferToolRequest(transaction, { runId: candidate.runId, attempt: candidate.attempt, toolInvocationRowId: reservationId, toolRevisionId: candidate.toolRevisionId, argumentsDigest: candidate.argumentsDigest, actionDigest: candidate.toolInvocationId, effectivePolicyDigest: capabilitySetDigest, approverPolicyRevision: "mcp-server-requires-approval", now: new Date(), expiresAt });
			if (result.outcome !== "unavailable") return true;
			const failed = await transaction.toolInvocation.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode: "approval_unavailable", completedAt: new Date() } });
			if (failed.count !== 1) throw new Error("deferred approval lost its reserved invocation fence");
			return false;
		});
	}
	catch
	{
		// A commit may have succeeded before its connection failed. A linked approval proves the reserved
		// invocation is not stranded; otherwise compare-and-set it to the terminal failed state.
		let approval = null;
		try
		{
			approval = await prisma.approvalRequest.findFirst({ where: { runId: candidate.runId, attempt: candidate.attempt, actionDigest: candidate.toolInvocationId, toolInvocationRowId: reservationId } });
		}
		catch
		{
			// The compare-and-set below remains the best available terminalisation if a read failed.
		}
		if (approval !== null) return true;
		try
		{
			return (await repository.markFailed(reservationId, "approval_defer_failed")).status === "failed";
		}
		catch
		{
			return false;
		}
	}
}

/** Bounded lifetime of a pending deferred-tool approval before it is no longer actionable. */
const _DEFERRED_APPROVAL_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

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
	const runDispatchRepository = new PrismaRunDispatchRepository(prisma, { namespace: runtimeNamespace, claimLeaseMilliseconds, assignmentTtlMilliseconds, publishedOutboxRetentionMilliseconds, outboxPruneBatchSize }, _IssueAttemptModelKey);
	const skillWorkloadClaimsRepository = new PrismaSkillWorkloadClaimsRepository(prisma, claimLeaseMilliseconds);
	const runtimeTokenReviewer = _CreateRuntimeTokenReviewer(authApi, runtimeNamespace);
	const runtimeDispatchAuthority = new PrismaRuntimeDispatchAuthority(prisma, { namespace: runtimeNamespace, commandTtlMilliseconds, externalActionRetryLimit: 3, externalActionRetryWindowMilliseconds: 30_000 }, _CreatePersonalRunInputCompiler(), _CreateExternalActionRunner(prisma));
	const replayRouteId = _ReadChannelReplayRouteId();
	if (replayRouteId !== null)
	{
		// The registered route ID pins this PEP to one controller-selected internal endpoint.
		app.use("/api/internal/conversation-replay", __CreateConversationReplayRouter({ contexts: new PrismaChannelTargetAuthorityRepository(prisma), repository: new PrismaConversationReplayRepository(prisma), expectedRouteId: replayRouteId, nowEpochMs: function _now() { return Date.now(); } }));
	}
	app.use("/api/internal/agent-controller", __CreateAgentControllerRunDispatchRouter({ tokenReviewer: _CreateAgentControllerTokenReviewer(authApi, serverNamespace), namespace: serverNamespace, repository: runDispatchRepository, logger: _log }));
	app.use("/api/internal/agent-controller", __CreateSkillWorkloadDispatchRouter({ tokenReviewer: _CreateAgentControllerTokenReviewer(authApi, serverNamespace), namespace: serverNamespace, repository: skillWorkloadClaimsRepository, logger: _log }));
	app.use("/api/internal/agent-runtime", __CreateSkillWorkloadBootstrapRouter({ tokenReviewer: _CreateSkillWorkloadTokenReviewer(authApi), repository: new PrismaSkillWorkloadBootstrapRepository(prisma), logger: _log }));
	app.use("/api/internal/agent-runtime", __CreateSkillAuthoringInputRouter({ tokenReviewer: _CreateSkillWorkloadTokenReviewer(authApi), repository: new PrismaSkillAuthoringInputRepository(prisma), artifactReader: _CreateSkillAuthoringArtifactReader(), logger: _log }));
	app.use("/api/internal/agent-runtime", __CreateSkillAuthoringCompletionRouter({ tokenReviewer: _CreateSkillWorkloadTokenReviewer(authApi), repository: new PrismaSkillAuthoringCompletionRepository(prisma), logger: _log }));
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
	commandRecoveryMilliseconds: _ReadBoundedSeconds("AGENT_RUNTIME_COMMAND_RECOVERY_POLL_SECONDS", 5, 5, 300),
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
 * @param runAdmission - Shared, capacity-bounded admission path for managed run-now requests.
 * @returns The configured Express application.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, authApi: k8s.AuthenticationV1Api, runAdmission: ManagedRunAdmissionPort): Express
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
  app.use("/api/v1/agent-services", _CreateAgentServicesRouter(prisma, runAdmission));
  app.use("/api/v1/me/persona", _CreatePersonaOnboardingRouter(prisma));
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
