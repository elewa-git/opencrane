import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";
import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import type { RunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { __CreateStandaloneFirstUserAdmissionAuditAppender } from "@opencrane/backend/server/iam/audit";
import { ___AuthRouter, ___CreateOidcAuthService, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionConfig } from "@opencrane/backend/server/iam/identity";
import { ___RequestContext } from "@opencrane/backend/observability";
import { ___AuthMiddleware } from "@opencrane/backend/server/infra/auth";
import { _ErrorHandler, _RateLimit, _TransportSecurity } from "@opencrane/backend/server/infra/http";

import { _log } from "./log.js";
import type { PublicAuthenticationComposition } from "./public-app.types.js";
import { _RegisterRoutes } from "./routes.js";
import { _CreateHttpRequestLogger } from "./telemetry.js";

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
	return { authService, sessionMiddleware: authService.createSessionMiddleware() };
}

/**
 * Build the ingress-facing Express application.
 *
 * Authentication precedes every product route, while the OIDC router remains public so it can
 * establish the browser session that the product routes require.
 * @param prisma - The main product database client.
 * @param coreApi - Kubernetes core client passed only to routes that create scoped Secrets.
 * @param runAdmission - Managed run admission port shared with scheduler execution.
 * @param personalRunAdmission - Browser-session personal run admission port.
 * @param runCancellation - Shared attempt-fenced cancellation authority.
 * @param serverNamespace - Namespace in which provider credentials are managed.
 * @param obotCustody - Composed Obot custody authority; fail-closed when the transport is disabled.
 * @param authentication - One browser-session composition shared with the internal resolver.
 * @returns The public Express listener before the lifecycle starts it.
 */
export function _CreatePublicApp(prisma: PrismaClient, coreApi: k8s.CoreV1Api, runAdmission: ManagedRunAdmissionPort, personalRunAdmission: PersonalRunAdmissionPort, runCancellation: RunCancellationRepository, serverNamespace: string, obotCustody: ObotCustodyPort, authentication: PublicAuthenticationComposition): Express
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

	// 3. Mount session establishment before the product-authentication boundary.
	app.use(...authentication.sessionMiddleware);
	app.use("/api/v1/auth", ___AuthRouter(authentication.authService, prisma));
	app.use(___AuthMiddleware());

	// 4. Mount authenticated product routes, then terminate failures through one structured handler.
	_RegisterRoutes(app, prisma, coreApi, runAdmission, personalRunAdmission, runCancellation, serverNamespace, obotCustody);
	app.use(_ErrorHandler(_log));
	return app;
}
