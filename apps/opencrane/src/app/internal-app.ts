import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express, type RequestHandler } from "express";

import { ___RequestContext } from "@opencrane/backend/observability";
import { _ErrorHandler } from "@opencrane/backend/server/infra/http";

import type { InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import { _RegisterInternalRoutes } from "./routes";
import { _CreateHttpRequestLogger } from "./telemetry";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

/** Fails closed when an isolated app test does not supply the process workflow engine. */
const _UnavailableWorkflowExecution: Pick<IWorkflowEngine, "emitEvent" | "spawn"> = {
	async emitEvent(): Promise<never>
	{
		throw new Error("workflow event execution is unavailable");
	},
	async spawn(): Promise<never>
	{
		throw new Error("workflow task admission is unavailable");
	},
};

/**
 * Build the workload-facing Express application.
 *
 * It shares the public listener's signed-session middleware only so channel-proxy can delegate the
 * browser cookie. Every resolver request independently TokenReviews the proxy workload identity.
 *
 * @param workflowExecution - Process engine forwarded to `_RegisterInternalRoutes`.
 */
export function _CreateInternalApp(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, sessionMiddleware: readonly RequestHandler[], workflowExecution: Pick<IWorkflowEngine, "emitEvent" | "spawn"> = _UnavailableWorkflowExecution): Express
{
	const app = express();

	// 1. Apply route-specific body ceilings before the generic parser consumes the request stream.
	app.set("trust proxy", 1);
	app.use("/api/internal/agent-runtime", express.json({ limit: 64 * 1_024, strict: true }));
	app.use("/api/internal/artifact-scanner", express.json({ limit: 16 * 1_024, strict: true }));
	app.use("/api/internal/artifact-preprocessor/jobs/:jobId/output", express.raw({ type: "text/plain", limit: config.artifactPreprocessorMaximumOutputBytes }));
	app.use(express.json());
	app.use(...sessionMiddleware);

	// 2. Correlate every internal request without treating correlation as authentication.
	app.use(___RequestContext());
	app.use(_CreateHttpRequestLogger(_log));

	// 3. Mount only workload-facing routes and terminate failures through the structured handler.
	_RegisterInternalRoutes(app, prisma, authApi, config, workflowExecution);
	app.use(_ErrorHandler(_log));
	return app;
}
