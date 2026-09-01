import type * as k8s from "@kubernetes/client-node";
import express, { type Express } from "express";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import type { RunCancellationRepository, SelfRunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "@opencrane/backend/server/iam/audit-writer";
import { ___AuthRouter, ___CreateOidcAuthService, PrismaAuthenticatedPrincipalAdmissionUnitOfWork, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";
import { ___RequestContext } from "@opencrane/backend/observability";
import { ___AuthMiddleware } from "@opencrane/backend/server/infra/auth";
import { _CheckHealth, _ErrorHandler, _RateLimit, _TransportSecurity, type PublicHealthReportReader } from "@opencrane/backend/server/infra/http";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { ProviderEffectCommandExecutor } from "@opencrane/backend/server/gateways/providers";

import { _log } from "./log";
import type { OpenCraneOrganizationMembershipConfig } from "./config.types";
import { _CreateOrganizationMembersComposition } from "./organization-members-composition";
import type { PublicAuthenticationComposition } from "./public-app.types";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";
import { _RegisterRoutes } from "./routes";
import { _CreateHttpRequestLogger } from "./telemetry";

/** Reuses the OIDC composition's database-client type so this application root does not import Prisma directly. */
type PrismaClient = Parameters<typeof ___CreateOidcAuthService>[1];

/**
 * Build the audit-log appender for the standalone first-owner claim, or null when that claim is not configured.
 * @see __CreateStandaloneFirstUserAdmissionAuditAppender
 */
function _CreateStandaloneFirstUserAudit(config: StandaloneFirstUserAdmissionConfig | null): StandaloneFirstUserAdmissionAuditPort | null
{
  return config === null ? null : __CreateStandaloneFirstUserAdmissionAuditAppender();
}

/** Build one session store so channel-proxy cookie delegation resolves the public login session. */
export function _CreatePublicAuthentication(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null): PublicAuthenticationComposition
{
	const authService = ___CreateOidcAuthService(_log, prisma, customApi, standaloneFirstUserAdmission, _CreateStandaloneFirstUserAudit(standaloneFirstUserAdmission));
	const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, _log);
	const authMiddleware = ___AuthMiddleware(admission, _log);
	return {
		authMiddleware,
		router: ___AuthRouter(authService),
		sessionMiddleware: authService.createSessionMiddleware(),
	};
}

/**
 * Build the ingress-facing Express application.
 *
 * Authentication precedes every product route, while the OIDC router remains public so it can
 * establish the browser session that the product routes require.
 * @param prisma - The main product database client.
 * @param runAdmission - Managed run admission port shared with scheduler execution.
 * @param personalRunAdmission - Browser-session personal run admission port.
 * @param runCancellation - Shared attempt-fenced cancellation authority.
 * @param authentication - One browser-session composition shared with the internal resolver.
 * @param organizationMembership - Startup-selected standalone or Fleet member configuration.
 * @param artifactServiceEnabled - Whether conversation assets have a backing service.
 * @param artifactScannerEnabled - Whether newly quarantined conversation files can be consumed.
 * @param skillAuthoringValidationEnabled - Whether a workflow worker can consume validation tasks.
 * @param health - Cached public service report reader with no topology or error details.
 * @param workflowExecution - Shared workflow admission used by public product mutations.
 * @param mcpWorkflows - Saved MCP task authorities, or null when the profile omits MCP services.
 * @param mcpRuntime - Runtime routes, or null when the application profile omits Kubernetes workloads.
 * @param providerEffects - Provider and model mutations routed through the shared effect executor.
 * @returns The public Express listener before the lifecycle starts it.
 */
export function _CreatePublicApp(prisma: PrismaClient, runAdmission: ManagedRunAdmissionPort, personalRunAdmission: PersonalRunAdmissionPort, runCancellation: RunCancellationRepository & SelfRunCancellationRepository, authentication: PublicAuthenticationComposition, organizationMembership: OpenCraneOrganizationMembershipConfig, artifactServiceEnabled: boolean, artifactScannerEnabled: boolean, skillAuthoringValidationEnabled: boolean, health: PublicHealthReportReader, workflowExecution: IWorkflowEngine, mcpWorkflows: McpWorkflowComposition | null, mcpRuntime: McpRuntimeComposition | null, providerEffects: ProviderEffectCommandExecutor): Express
{
	const app = express();

	// 1. Establish transport and parsing limits before a request reaches identity or product state.
	app.set("trust proxy", 1);
	app.use(_TransportSecurity());
	app.use(express.json());
	app.use(_RateLimit());

	// 2. Seed correlation before request logging so every downstream log shares the same request ID.
	app.use(___RequestContext());
	app.use(_CreateHttpRequestLogger(_log));

	// 3. Publish the fixed service map before session work so health remains available during an
	//    identity-provider outage without exposing any authenticated product state.
	app.get("/healthz", _CheckHealth(health, _log));

	// 4. Mount session establishment before the product-authentication boundary.
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", authentication.router);
	app.use(authentication.authMiddleware);
	const organizationMembers = _CreateOrganizationMembersComposition(prisma, organizationMembership);

	if (organizationMembers.productAccess !== null)
	{
		app.use(organizationMembers.productAccess);
	}

	// 5. Mount authenticated product routes, then terminate failures through one structured handler.
	_RegisterRoutes(app, prisma, runAdmission, personalRunAdmission, runCancellation, artifactServiceEnabled, artifactScannerEnabled, skillAuthoringValidationEnabled, organizationMembers.router, workflowExecution, mcpWorkflows, mcpRuntime, providerEffects);
	app.use(_ErrorHandler(_log));
	return app;
}
