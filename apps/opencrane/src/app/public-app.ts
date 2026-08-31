import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";
import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "@opencrane/backend/server/iam/audit";
import { ___AuthRouter, ___CreateOidcAuthService, PrismaAuthenticatedPrincipalAdmissionUnitOfWork, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";
import { ___RequestContext } from "@opencrane/backend/observability";
import { ___AuthMiddleware } from "@opencrane/backend/server/infra/auth";
import { _CheckHealth, _ErrorHandler, _RateLimit, _TransportSecurity, type PublicHealthReportReader } from "@opencrane/backend/server/infra/http";

import { _log } from "./log";
import type { OrganizationMembersComposition } from "./organization-members-composition.types";
import type { PublicAuthenticationComposition } from "./public-app.types";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";
import type { McpWorkflowComposition } from "./mcp-workflow-composition.types";
import { _RegisterRoutes } from "./routes";
import { _CreateHttpRequestLogger } from "./telemetry";

/**
 * Builds the audit-log appender for the standalone first-owner claim, or null when that claim is not configured.
 * @see __CreateStandaloneFirstUserAdmissionAuditAppender
 */
function _CreateStandaloneFirstUserAudit(config: StandaloneFirstUserAdmissionConfig | null): StandaloneFirstUserAdmissionAuditPort | null
{
  return config === null ? null : __CreateStandaloneFirstUserAdmissionAuditAppender();
}

/**
 * Builds the production OIDC session, router, and Principal-admission middleware together.
 *
 * Called by: the production composition root when Tier 3 development authentication is not selected.
 * @param prisma - Product authority used for login projection and current membership reads.
 * @param customApi - Kubernetes API used to resolve per-silo OIDC clients.
 * @param standaloneFirstUserAdmission - Optional installation contract for the first Owner claim.
 * @returns The browser authentication handlers shared by public HTTP, internal delegation, and sockets.
 */
export function _CreatePublicAuthentication(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null): PublicAuthenticationComposition
{
	const authService = ___CreateOidcAuthService(_log, prisma, customApi, standaloneFirstUserAdmission, _CreateStandaloneFirstUserAudit(standaloneFirstUserAdmission));
	const admission = new PrismaAuthenticatedPrincipalAdmissionUnitOfWork(prisma, _log);
	const authMiddleware = ___AuthMiddleware(admission, _log);
	return {
		authMiddleware,
		productAuthentication: authMiddleware,
		router: ___AuthRouter(authService),
		sessionMiddleware: authService.createSessionMiddleware(),
	};
}

/**
 * Builds the ingress-facing Express application.
 *
 * Authentication precedes every product route, while the selected login router remains public so
 * it can establish the browser session that product routes require.
 *
 * Called by: the production and Tier 2 composition roots after they select authentication and membership authorities.
 * @param prisma - The main product database client.
 * @param coreApi - Kubernetes core client passed only to routes that create scoped Secrets.
 * @param runAdmission - Managed run admission port shared with scheduler execution.
 * @param personalRunAdmission - Browser-session personal run admission port.
 * @param runCancellation - Shared attempt-fenced cancellation authority.
 * @param serverNamespace - Namespace in which provider credentials are managed.
 * @param obotCustody - Composed Obot custody authority; fail-closed when the transport is disabled.
 * @param authentication - One browser-session composition shared with the internal resolver.
 * @param organizationMembers - Startup-selected standalone or Fleet member composition.
 * @param artifactServiceEnabled - Whether conversation assets have a backing service.
 * @param artifactScannerEnabled - Whether newly quarantined conversation files can be consumed.
 * @param health - Cached public service report reader with no topology or error details.
 * @param mcpWorkflows - Shared transaction and worker authority for saved MCP jobs.
 * @param mcpRuntime - Runtime routes, or null when the application profile omits Kubernetes workloads.
 * @returns The public Express listener before the lifecycle starts it.
 */
export function _CreatePublicApp(prisma: PrismaClient, coreApi: k8s.CoreV1Api, runAdmission: ManagedRunAdmissionPort, personalRunAdmission: PersonalRunAdmissionPort, runCancellation: RunCancellationRepository, serverNamespace: string, obotCustody: ObotCustodyPort, authentication: PublicAuthenticationComposition, organizationMembers: OrganizationMembersComposition, artifactServiceEnabled: boolean, artifactScannerEnabled: boolean, health: PublicHealthReportReader, mcpWorkflows: McpWorkflowComposition | null, mcpRuntime: McpRuntimeComposition | null): Express
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
	app.use(authentication.productAuthentication);

	if (organizationMembers.productAccess !== null)
	{
		app.use(organizationMembers.productAccess);
	}

	// 5. Mount authenticated product routes, then terminate failures through one structured handler.
	_RegisterRoutes(app, prisma, coreApi, runAdmission, personalRunAdmission, runCancellation, serverNamespace, obotCustody, artifactServiceEnabled, artifactScannerEnabled, organizationMembers.router, mcpWorkflows, mcpRuntime);
	app.use(_ErrorHandler(_log));
	return app;
}
