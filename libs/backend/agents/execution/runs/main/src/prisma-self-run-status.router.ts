import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/server/_infra/auth";

import { PrismaSelfRunStatusRepository } from "./prisma-self-run-status-repository.js";
import { __CreateSelfRunStatusRouter } from "./self-run-status.router.js";
import type { SelfRunStatusCaller } from "./self-run-status.router.types.js";

/** Maps authenticated request facts to the caller contract owned by personal run status. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfRunStatusCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed self-only personal run-status router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured self-run status router.
 */
export function _CreateSelfRunStatusRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSelfRunStatusRouter({
		resolveCaller: _resolveCaller,
		repository: new PrismaSelfRunStatusRepository(prisma),
		logger,
	});
}
