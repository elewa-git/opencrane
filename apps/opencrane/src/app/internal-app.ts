import * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";
import express, { type Express } from "express";

import { ___RequestContext } from "@opencrane/backend/observability";
import { _ErrorHandler } from "@opencrane/backend/server/infra/http";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { InternalRuntimeConfig } from "./config.types";
import { _log } from "./log";
import { _RegisterInternalRoutes } from "./routes";
import { _CreateHttpRequestLogger } from "./telemetry";
import type { McpRuntimeComposition } from "./mcp-runtime-composition.types";

/** Fails closed when an isolated app test does not supply the process workflow engine. */
const _UnavailableWorkflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction"> = {
	async spawn(): Promise<never>
	{
		throw new Error("workflow task admission is unavailable");
	},
	async emitEventInTransaction(): Promise<never>
	{
		throw new Error("workflow event admission is unavailable");
	},
};

/**
 * Build the workload-facing Express application.
 *
 * It carries no browser session middleware: every route on this listener TokenReviews the calling
 * workload itself.
 */
export function _CreateInternalApp(prisma: PrismaClient, authApi: k8s.AuthenticationV1Api, config: InternalRuntimeConfig, mcpRuntime: McpRuntimeComposition, workflowExecution: Pick<IWorkflowEngine, "spawn" | "emitEventInTransaction"> = _UnavailableWorkflowExecution, conversationComputerTurn?: import("express").Router, conversationComputerCheckpoint?: import("express").Router): Express
{
	const app = express();

	// 1. Correlate requests before parsers or early computer handlers can return a response.
	app.set("trust proxy", 1);
	app.use(___RequestContext());
	app.use(_CreateHttpRequestLogger(_log));

	// 2. Apply route-specific body ceilings before the generic parser consumes the request stream.
	app.use("/api/internal/skill-authoring", express.json({ limit: 64 * 1_024, strict: true }));
	app.use("/api/internal/mcp-executor", express.json({ limit: 4_456_448, strict: true }));
	app.use("/api/internal/artifact-scanner", express.json({ limit: 16 * 1_024, strict: true }));
	if (conversationComputerTurn !== undefined)
		app.use("/api/internal/conversation-computer", express.json({ limit: 70 * 1_024, strict: true }), conversationComputerTurn);
	if (conversationComputerCheckpoint !== undefined)
		app.use("/api/internal/conversation-computer/checkpoint", express.json({ limit: 16 * 1_024, strict: true }), conversationComputerCheckpoint);
	app.use("/api/internal/artifact-preprocessor/jobs/:jobId/output", express.raw({ type: "text/plain", limit: config.artifactPreprocessorMaximumOutputBytes }));
	app.use(express.json());

	// 3. Mount only workload-facing routes and terminate failures through the structured handler.
	_RegisterInternalRoutes(app, prisma, authApi, config, mcpRuntime, workflowExecution);
	app.use(_ErrorHandler(_log));
	return app;
}
