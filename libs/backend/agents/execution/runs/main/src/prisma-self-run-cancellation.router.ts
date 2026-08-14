import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaSelfRunCancellationRepository } from "./prisma-self-run-cancellation-repository";
import type { RunCancellationRepository } from "./run-cancellation.types";
import { __CreateSelfRunCancellationRouter } from "./self-run-cancellation.router";
import type { SelfRunCancellationCaller } from "./self-run-cancellation.types";

/** Turns the authenticated request's principal into the caller shape cancellation expects. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfRunCancellationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/** Compose the Prisma-backed self-only run-cancellation router. */
export function _CreateSelfRunCancellationRouter(prisma: PrismaClient, cancellation: RunCancellationRepository, logger: Logger): Router
{
	return __CreateSelfRunCancellationRouter({
		resolveCaller: _resolveCaller,
		cancellation: new PrismaSelfRunCancellationRepository(prisma, cancellation),
		logger,
	});
}
