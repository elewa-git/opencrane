import express, { type Express, type Router } from "express";

import { ___RequestContext } from "@opencrane/backend/observability";
import { _CreateHttpRequestLogger, _ErrorHandler } from "@opencrane/backend/server/infra/http";

import { _log } from "../process/log";
import { _RegisterInternalRoutes } from "./routes";
import type { InternalRouteDependencies } from "./routes.types";

/**
 * Build the workload-facing Express application.
 *
 * It carries no browser session middleware: every route on this listener TokenReviews the calling
 * workload itself.
 *
 * @param dependencies - Long-lived services shared by the workload-facing routes.
 * @param conversationComputerReviewCredential - Computer review-credential router, mounted before the generic parser.
 * @param conversationComputerCheckpoint - Computer checkpoint router, mounted with its own body ceiling.
 * @returns The internal Express listener before the lifecycle starts it.
 */
export function _CreateInternalApp(dependencies: InternalRouteDependencies, conversationComputerReviewCredential?: Router, conversationComputerCheckpoint?: Router): Express
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
	if (conversationComputerReviewCredential !== undefined)
		app.use("/api/internal/conversation-computer", conversationComputerReviewCredential);
	if (conversationComputerCheckpoint !== undefined)
		app.use("/api/internal/conversation-computer/checkpoint", express.json({ limit: 16 * 1_024, strict: true }), conversationComputerCheckpoint);
	app.use("/api/internal/artifact-preprocessor/jobs/:jobId/output", express.raw({ type: "text/plain", limit: dependencies.config.artifactPreprocessorMaximumOutputBytes }));
	app.use(express.json());

	// 3. Mount only workload-facing routes and terminate failures through the structured handler.
	_RegisterInternalRoutes(app, dependencies);
	app.use(_ErrorHandler(_log));
	return app;
}
