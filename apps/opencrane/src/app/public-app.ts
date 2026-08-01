import { randomUUID } from "node:crypto";

import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";

import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { ___AuthRouter, ___CreateOidcAuthService } from "@opencrane/backend/server/iam/identity";
import { ___GetContext, ___RequestContext } from "@opencrane/observability";
import { ___AuthMiddleware } from "@opencrane/server/_infra/auth";
import { _ErrorHandler, _RateLimit, _TransportSecurity } from "@opencrane/server/_infra/http";

import { _log } from "./log.js";
import { _RegisterRoutes } from "./routes.js";

/**
 * Build the ingress-facing Express application.
 *
 * Authentication precedes every product route, while the OIDC router remains public so it can
 * establish the browser session that the product routes require.
 * @param prisma - Canonical product-authority database client.
 * @param customApi - Kubernetes custom-resource client used by the OIDC integration.
 * @param coreApi - Kubernetes core client passed only to routes that create scoped Secrets.
 * @param runAdmission - Managed run admission port shared with scheduler execution.
 * @param personalRunAdmission - Browser-session personal run admission port.
 * @param authWatchNamespace - Namespace in which OIDC authentication resources are watched.
 * @param serverNamespace - Namespace in which provider credentials are managed.
 * @returns The public Express listener before the lifecycle starts it.
 */
export function _CreatePublicApp(prisma: PrismaClient, customApi: k8s.CustomObjectsApi, coreApi: k8s.CoreV1Api, runAdmission: ManagedRunAdmissionPort, personalRunAdmission: PersonalRunAdmissionPort, authWatchNamespace: string, serverNamespace: string): Express
{
	const app = express();
	const authService = ___CreateOidcAuthService(_log, prisma, customApi, authWatchNamespace);

	// 1. Establish transport and parsing limits before a request reaches identity or product state.
	app.set("trust proxy", 1);
	app.use(_TransportSecurity());
	app.use(express.json());
	app.use(_RateLimit());

	// 2. Seed correlation before request logging so every downstream log shares the same request ID.
	app.use(___RequestContext());
	app.use(pinoHttp({ logger: _log, genReqId: function _genRequestId() { return ___GetContext()?.requestId ?? randomUUID(); } }));

	// 3. Mount session establishment before the product-authentication boundary.
	app.use(...authService.createSessionMiddleware());
	app.use("/api/v1/auth", ___AuthRouter(authService, prisma));
	app.use(___AuthMiddleware());

	// 4. Mount authenticated product routes, then terminate failures through one structured handler.
	_RegisterRoutes(app, prisma, coreApi, runAdmission, personalRunAdmission, serverNamespace);
	app.use(_ErrorHandler(_log));
	return app;
}
