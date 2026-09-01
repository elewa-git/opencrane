import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { __CreateSelfRunCancellationRouter } from "./self-run-cancellation.router";
import type { SelfRunCancellationCaller, SelfRunCancellationRepository } from "./self-run-cancellation.types";

/** Turns the authenticated request's principal into the caller shape cancellation expects. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfRunCancellationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { principalId: principal.principalId, subjectId: principal.externalSubject, siloId: principal.siloId } : null;
}

/** Compose the Prisma-backed self-only run-cancellation router. */
export function _CreateSelfRunCancellationRouter(cancellation: SelfRunCancellationRepository, logger: Logger): Router
{
	return __CreateSelfRunCancellationRouter({
		resolveCaller: _resolveCaller,
		cancellation,
		logger,
	});
}
