import { Router, type Express, type Request } from "express";
import type { PrismaClient } from "@prisma/client";
import type * as k8s from "@kubernetes/client-node";

import { aiBudgetRouter, tokenUsageRouter } from "@opencrane/backend/server/reporting/spend";
import { auditRouter } from "@opencrane/backend/server/iam/audit";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { groupsRouter } from "@opencrane/backend/server/iam/groups";
import { _IssueAttemptLiteLlmKey, modelRoutingDefaultsRouter } from "@opencrane/backend/server/gateways/model-routing";
import { _CreateMcpCallerResolver, mcpOperatorRouter, mcpTaskRouter } from "@opencrane/backend/server/gateways/mcp";
import { _CreateGlobalModelRoutingDefaultCommandPort, providerByokRouter, modelRegistryRouter, type ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";
import { PrismaResourceShareUnitOfWork, ResourceShareService, resourceSharesRouter, type ResourceShareCallerResolver } from "@opencrane/backend/server/iam/grants";
import { PrismaAuthenticatedPrincipalDirectoryUnitOfWork, type AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { thirdPartySourcesRouter } from "@opencrane/backend/server/knowledge/retrieval";
import { spec } from "@opencrane/backend/server/api-spec";
import { _CreateSelfElicitationActivityRouter, _CreateSelfElicitationRouter } from "@opencrane/backend/agents/execution/elicitation";
import { _CreateSelfRunStatusRouter } from "@opencrane/backend/agents/execution/runs";
import { _CreatePersonaOnboardingRouter } from "@opencrane/backend/agents/personal/personas";
import { type UserOnboardingOwnerResolver } from "@opencrane/backend/server/agents/onboarding";
import { _CreatePersonalArtifactCatalogueRouter } from "@opencrane/backend/server/agents/artifacts";
import { _CreatePersonalConfigurationRouter } from "@opencrane/backend/agents/personal/configuration";
import { __CreateConversationAssetRouter } from "@opencrane/backend/server/conversation-assets";
import { _CreateConversationHistoryComposition, _ReadConversationPrivatePayloadKeyring } from "./conversation-history-composition";
import { _ConversationComputerReviewAuthority, _CreateConversationComputerReviewRouter, ConversationComputerHistory, KeyedConversationComputerReviewCredentialDeriver, PrismaConversationMetadataUnitOfWork } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { PrismaSkillAuthoringValidationSubmissionUnitOfWork, _CreateSkillCatalogueRouter, __CreateSkillAuthoringValidationSubmissionRouter } from "@opencrane/backend/server/agents/skills";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { _OpenapiRouter, _RateLimit } from "@opencrane/backend/server/infra/http";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { AgentSandboxReleaseProfileConfig, InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import { _CreateInternalRuntimeComposition } from "./runtime-composition";
import { _CreatePersonaAgentRevisionSelectionFactory } from "./persona-approval-composition";
import type { ResourceSharesRouteOptions, RouteMount } from "./routes.types";
import { _CreateCompanyAssistantComposition } from "./company-assistant-composition";
import { _CreateUserOnboardingComposition } from "./user-onboarding-composition";
import { _CreateConversationAssetAuthority } from "../infra/artifacts/artifact-upload.factory";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";

/**
 * Register the authenticated product API from functional route lists.
 *
 * Called by: public-app.ts, after it has mounted the session middleware and `___AuthMiddleware`.
 *
 * @param app - Public Express listener, already protected by browser-session authentication.
 * @param prisma - The main product database client.
 * @param artifactScannerEnabled - Whether upload admission has a live scanner consumer.
 * @param organizationMembersRouter - Startup-selected standalone or Fleet member authority.
 * @param mcpWorkflows - Shared guarded workflow engine plus saved MCP task authorities.
 * @returns The configured public listener.
 * @throws When the deployment has not supplied its conversation-computer profile.
 */
export function _RegisterRoutes(app: Express, prisma: PrismaClient, artifactScannerEnabled: boolean, organizationMembersRouter: Router, mcpWorkflows: McpWorkflowComposition, mcpRuntime: McpRuntimeComposition, providerEffects: ProviderEffectCommandExecutor, historyStore?: HistoryStore, conversationPrivatePayloadKeyringPath?: string, agentSandboxReleaseProfile?: AgentSandboxReleaseProfileConfig): Express
{
	if (agentSandboxReleaseProfile === undefined)
		throw new Error("Product routes require the configured conversation-computer profile");
	const onboarding = _CreateUserOnboardingComposition(prisma, _log, _ResolveUserOnboardingOwner, agentSandboxReleaseProfile.profileName, [agentSandboxReleaseProfile.profileName]);
	const conversationHistory = historyStore === undefined || conversationPrivatePayloadKeyringPath === undefined ? null : _CreateConversationHistoryComposition(prisma, historyStore, conversationPrivatePayloadKeyringPath, agentSandboxReleaseProfile, mcpWorkflows.execution);
	const unavailableInitialComputer = { resolve: async function _Unavailable() { return null; }, createOrdinaryGenesis: async function _UnavailableGenesis() { throw new Error("review composition cannot create conversations"); } };
	const computerReviewAuthority = historyStore === undefined || conversationPrivatePayloadKeyringPath === undefined ? null : new _ConversationComputerReviewAuthority(new PrismaConversationMetadataUnitOfWork(prisma, unavailableInitialComputer), new ConversationComputerHistory(historyStore), KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_ReadConversationPrivatePayloadKeyring(conversationPrivatePayloadKeyringPath)));
	const computerReview = computerReviewAuthority === null ? null : _CreateConversationComputerReviewRouter({ authority: computerReviewAuthority, sandboxNamespace: agentSandboxReleaseProfile.namespace, logger: _log }, _ResolveRequestPrincipal);
	const principalDirectory = new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma);
	const identityAndAccessRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/audit", handler: auditRouter(prisma, function _CreateAuditAuthorization(transaction) { return new PrismaAuthorizationAuthority(transaction); }) },
		{ method: "use", path: "/api/v1/groups", handler: groupsRouter(prisma) },
		{ method: "use", path: "/api/v1/organization/members", handler: organizationMembersRouter },
		{ method: "use", path: "/api/v1/resource-shares", handler: _CreateRateLimitedResourceSharesRouter(prisma) },
	];
	const agentRoutes: readonly RouteMount[] = [
		..._OptionalRoute("/api/v1/organization/company-assistant", historyStore === undefined ? null : _CreateCompanyAssistantComposition(prisma, historyStore, agentSandboxReleaseProfile)),
		{ method: "use", path: "/api/v1/skills", handler: _CreateSkillCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/skills", handler: __CreateSkillAuthoringValidationSubmissionRouter({ resolveCaller: _ResolveSkillAuthoringValidationCaller, authority: new PrismaSkillAuthoringValidationSubmissionUnitOfWork(prisma, mcpWorkflows.execution), logger: _log }) },
	];
	const personalWorkspaceRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/me/onboarding", handler: onboarding.router },
		{ method: "use", path: "/api/v1/me/assets", handler: _CreatePersonalArtifactCatalogueRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/persona", handler: _CreatePersonaOnboardingRouter(prisma, _log, onboarding.personaWorkflow, _CreatePersonaAgentRevisionSelectionFactory()) },
		{ method: "use", path: "/api/v1/me/configuration", handler: _CreatePersonalConfigurationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/runs", handler: _CreateSelfRunStatusRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/conversations", handler: __CreateConversationAssetRouter({ resolveCaller: _ResolveConversationAssetCaller, authority: _CreateConversationAssetAuthority(prisma, process.env, artifactScannerEnabled), logger: _log }) },
		..._OptionalRoute("/api/v1/me/conversations", conversationHistory),
		..._OptionalRoute("/api/v1/me/conversations", computerReview),
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfElicitationRouter(prisma, _log) },
		{ method: "use", path: "/api/v1/me/activity", handler: _CreateSelfElicitationActivityRouter(prisma, _log) },
	];
	const gatewayRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/mcp", handler: mcpOperatorRouter(mcpWorkflows.unitOfWork, principalDirectory, mcpWorkflows.eraProbeWorkflow, mcpWorkflows.ociImageValidationWorkflow, mcpWorkflows.ociImageArtifacts) },
		{ method: "use", path: "/api/v1/mcp", handler: mcpTaskRouter(mcpWorkflows.unitOfWork, mcpRuntime.taskWorkflow, _CreateMcpCallerResolver(principalDirectory)) },
		{ method: "use", path: "/api/v1/mcp", handler: mcpRuntime.promotion },
		{ method: "use", path: "/api/v1/model-routing/defaults", handler: modelRoutingDefaultsRouter(prisma, undefined, undefined, _CreateGlobalModelRoutingDefaultCommandPort(prisma, providerEffects)) },
		{ method: "use", path: "/api/v1/providers/byok", handler: providerByokRouter(prisma, providerEffects, _log) },
		{ method: "use", path: "/api/v1/models", handler: modelRegistryRouter(prisma, providerEffects) },
	];
	const knowledgeRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/third-party-sources", handler: thirdPartySourcesRouter(prisma) },
	];
	const reportingRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/ai-budget", handler: aiBudgetRouter(prisma) },
		{ method: "use", path: "/api/v1/token-usage", handler: tokenUsageRouter(prisma) },
	];
	// The public health route is mounted before authentication by public-app.ts. Everything here
	// either requires the browser session or publishes the static API description.
	const infrastructureRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/v1/openapi.json", handler: _OpenapiRouter(spec) },
	];
	_MountRouteAreas(app, [
		identityAndAccessRoutes,
		agentRoutes,
		personalWorkspaceRoutes,
		gatewayRoutes,
		knowledgeRoutes,
		reportingRoutes,
		infrastructureRoutes,
	]);
	return app;
}

/** Resolve the onboarding owner only from the authenticated user on the request, never from the request body. */
const _ResolveUserOnboardingOwner: UserOnboardingOwnerResolver = function _Owner(request)
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject };
};

/** Resolve conversation-file authority only from the verified browser principal. */
const _ResolveConversationAssetCaller = function _ConversationAssetCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0])
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject, principalId: principal.principalId };
};

/** Resolve skill validation authority only from the verified browser Principal and its silo. */
const _ResolveSkillAuthoringValidationCaller = function _SkillAuthoringValidationCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0])
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
};

/**
 * Composes resource-share authority behind the shared per-IP limiter before identity or database work.
 *
 * The grants domain stays transport-agnostic; the OpenCrane app owns HTTP abuse protection.
 *
 * Called by: `_RegisterRoutes` above for `/api/v1/resource-shares`, and
 * apps/opencrane/src/__tests__/shares-rate-limit.test.ts, which is why the limiter is tunable.
 *
 * @param prisma - The main product database client.
 * @param options - Optional bounded limiter tuning for an isolated application test.
 * @returns The protected sharing router.
 */
export function _CreateRateLimitedResourceSharesRouter(prisma: PrismaClient, options?: ResourceSharesRouteOptions): Router
{
	const router = Router();
	const service = new ResourceShareService(new PrismaResourceShareUnitOfWork(prisma));
	const resolveCaller = _CreateResourceShareCallerResolver(new PrismaAuthenticatedPrincipalDirectoryUnitOfWork(prisma));
	router.use(_RateLimit(options?.rateLimit));
	router.use(resourceSharesRouter(service, resolveCaller));
	return router;
}

/** Creates the HTTP adapter that resolves verified OIDC coordinates to a local Principal. */
function _CreateResourceShareCallerResolver(directory: AuthenticatedPrincipalDirectory): ResourceShareCallerResolver
{
	return async function _ResolveResourceShareCaller(request: Request)
	{
		const requestPrincipal = _ResolveRequestPrincipal(request);
		const authUser = request.session?.authUser;
		if (requestPrincipal === null || !authUser?.issuer || !authUser.sub)
			return null;
		return directory.resolveAuthenticatedPrincipal(requestPrincipal.siloId, authUser.issuer, authUser.sub);
	};
}

/**
 * Register the workload-facing API from explicit controller, authoring, and worker lists.
 *
 * None of these routes sits behind the browser-session guard, because none of their callers is a
 * browser. Each one authorises the bearer token on the request itself: the controller, authoring, and
 * worker routers put it through Kubernetes TokenReview and accept only a ServiceAccount from the
 * namespace their reviewer was built for. Being on the internal listener is not the protection — a
 * router mounted here without its own check would be open to every workload in the cluster.
 *
 * Skill-authoring validation workers use the `/api/internal/skill-authoring` base path.
 *
 * Called by: internal-app.ts, which builds the workload-facing Express listener.
 *
 * @param app - Internal Express listener, unreachable from the public ingress.
 * @param prisma - The main product database client.
 * @param authApi - Kubernetes TokenReview client for workload identity.
 * @param config - Frozen workload-facing configuration shared with workers and body parsing.
 */
export function _RegisterInternalRoutes(app: Express, prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, mcpRuntime: McpRuntimeComposition, workflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction">): void
{
	const runtime = _CreateInternalRuntimeComposition(prisma, authApi, config, workflowExecution);
	const internalControllerRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/agent-controller", handler: runtime.skillAuthoringValidationController },
		{ method: "use", path: "/api/internal/agent-controller", handler: mcpRuntime.controller },
		..._OptionalRoute("/api/internal/agent-controller", runtime.artifactPreprocessController),
	];
	const internalMcpExecutorRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/mcp-executor", handler: mcpRuntime.companion },
	];
	const internalRuntimeRoutes: readonly RouteMount[] = [
		{ method: "use", path: "/api/internal/skill-authoring", handler: runtime.skillAuthoringValidationWorker },
	];
	const internalWorkerRoutes = _OptionalRoute("/api/internal/artifact-preprocessor", runtime.artifactPreprocessor);
	const internalScannerRoutes = _OptionalRoute("/api/internal/artifact-scanner", runtime.artifactScanner);
	_MountRouteAreas(app, [internalControllerRoutes, internalRuntimeRoutes, internalMcpExecutorRoutes, internalWorkerRoutes, internalScannerRoutes]);
}

/** Return a one-entry route list for a router, or an empty list when the router is null. */
function _OptionalRoute(path: string, handler: Router | null): readonly RouteMount[]
{
	return handler === null ? [] : [{ method: "use", path, handler }];
}

/** Mount route areas in declaration order so neighbouring routers can intentionally share a path. */
function _MountRouteAreas(app: Express, areas: readonly (readonly RouteMount[])[]): void
{
	for (const area of areas)
	{
		for (const route of area)
		{
			if (route.method === "get")
				app.get(route.path, route.handler);
			else app.use(route.path, route.handler);
		}
	}
}
