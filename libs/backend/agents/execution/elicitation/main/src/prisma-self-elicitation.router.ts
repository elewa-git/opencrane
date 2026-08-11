import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaElicitationUnitOfWork } from "./prisma-elicitation-unit-of-work.js";
import { __CreateSelfElicitationRouter } from "./self-elicitation.router.js";
import type { SelfElicitationCaller } from "./self-elicitation.router.types.js";

/** Map trusted browser-session facts into the elicitation caller contract. */
function _ResolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfElicitationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { subjectId: principal.subjectId, siloId: principal.siloId, verifiedStepUpAt: principal.verifiedAuthenticationAt };
}

/** Compose the Prisma-backed self elicitation API. */
export function _CreateSelfElicitationRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSelfElicitationRouter({ resolveCaller: _ResolveCaller, elicitations: new PrismaElicitationUnitOfWork(prisma), clock: { now(): Date { return new Date(); } }, logger });
}
