import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import type { ElicitationConversationAccessFactory } from "./elicitation-conversation-access.types";
import { PrismaElicitationUnitOfWork } from "./prisma-elicitation-unit-of-work";
import { __CreateSelfElicitationActivityRouter, __CreateSelfElicitationRouter } from "./self-elicitation.router";
import type { ElicitationRunWakeFactory } from "./elicitation.types";
import type { SelfElicitationCaller } from "./self-elicitation.router.types";

/** Map trusted browser-session facts into the elicitation caller contract. */
function _ResolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfElicitationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { subjectId: principal.externalSubject, siloId: principal.siloId, verifiedStepUpAt: principal.verifiedAuthenticationAt };
}

/** Compose the Prisma-backed self elicitation API. */
export function _CreateSelfElicitationRouter(prisma: PrismaClient, logger: Logger, wakeFactory: ElicitationRunWakeFactory | null = null, conversationAccessFactory: ElicitationConversationAccessFactory | null = null): Router
{
	return __CreateSelfElicitationRouter({ resolveCaller: _ResolveCaller, elicitations: new PrismaElicitationUnitOfWork(prisma, wakeFactory, conversationAccessFactory), clock: { now(): Date { return new Date(); } }, logger });
}

/** Compose the Prisma-backed derived Activity index. */
export function _CreateSelfElicitationActivityRouter(prisma: PrismaClient, logger: Logger, conversationAccessFactory: ElicitationConversationAccessFactory | null = null): Router
{
	return __CreateSelfElicitationActivityRouter({ resolveCaller: _ResolveCaller, elicitations: new PrismaElicitationUnitOfWork(prisma, null, conversationAccessFactory), clock: { now(): Date { return new Date(); } }, logger });
}
