import { randomUUID } from "node:crypto";

import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";

import { ___GetContext, ___RequestContext } from "@opencrane/backend/observability";
import { _ErrorHandler } from "@opencrane/backend/_server/http";
import type { MemoryGatewayClient } from "@opencrane/backend/_server/memory-gateway-client";

import type { InternalRuntimeConfig } from "./config.types.js";
import { _log } from "./log.js";
import { _RegisterInternalRoutes } from "./routes.js";

/**
 * Build the workload-facing Express application.
 *
 * This app has no browser-session middleware because it is reachable only through the internal
 * Service and NetworkPolicy. Routes that cross a workload identity boundary perform TokenReview.
 */
export function _CreateInternalApp(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, memoryGateway: MemoryGatewayClient): Express
{
	const app = express();

	// 1. Apply route-specific body ceilings before the generic parser consumes the request stream.
	app.set("trust proxy", 1);
	app.use("/api/internal/agent-runtime", express.json({ limit: 64 * 1_024, strict: true }));
	app.use("/api/internal/artifact-preprocessor/jobs/:jobId/output", express.raw({ type: "text/plain", limit: config.artifactPreprocessorMaximumOutputBytes }));
	app.use(express.json());

	// 2. Correlate every internal request without treating correlation as authentication.
	app.use(___RequestContext());
	app.use(pinoHttp({ logger: _log, genReqId: function _genRequestId() { return ___GetContext()?.requestId ?? randomUUID(); } }));

	// 3. Mount only workload-facing routes and terminate failures through the structured handler.
	_RegisterInternalRoutes(app, prisma, authApi, config, memoryGateway);
	app.use(_ErrorHandler(_log));
	return app;
}
