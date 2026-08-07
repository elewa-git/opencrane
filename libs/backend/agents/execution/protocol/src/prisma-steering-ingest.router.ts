import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";

import { PrismaSteeringRequestRepository } from "./prisma-steering-request-repository.js";
import { __CreateSteeringIngestRouter } from "./steering-ingest.router.js";
import type { SteeringIngestCaller } from "./steering-ingest.router.types.js";

/** Maps authenticated request facts to the caller contract owned by runtime steering. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SteeringIngestCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed self-only runtime steering-ingest router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured steering-ingest router.
 */
export function _CreateSteeringIngestRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSteeringIngestRouter({
		resolveCaller: _resolveCaller,
		requests: new PrismaSteeringRequestRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
