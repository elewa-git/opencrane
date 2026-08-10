import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaConversationUnitOfWork } from "./prisma-conversation-unit-of-work.js";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository.js";
import { __CreateSelfConversationsRouter } from "./self-conversations.router.js";
import type { ConversationCaller } from "./conversation-authority.types.js";

/** Maps authenticated request facts to the caller contract owned by conversations. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): ConversationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/** Composes the Prisma-backed participant conversation router. */
export function _CreateSelfConversationsRouter(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, logger: Logger): Router
{
	return __CreateSelfConversationsRouter({ resolveCaller: _resolveCaller, authority: new PrismaConversationUnitOfWork(prisma, runAdmission, transaction => new PrismaConversationMutationRepository(transaction.prisma)), logger });
}
