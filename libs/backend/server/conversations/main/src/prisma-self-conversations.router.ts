import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaConversationMessageAdmissionUnitOfWork } from "./prisma-conversation-message-admission-unit-of-work.js";
import { PrismaConversationUnitOfWork } from "./prisma-conversation-unit-of-work.js";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository.js";
import { __CreateSelfConversationsRouter } from "./self-conversations.router.js";
import type { ConversationCaller } from "./conversation-authority.types.js";
import type { ConversationAttachmentAdmissionFactory } from "./conversation-message-admission.types.js";

/** Maps authenticated request facts to the caller contract owned by conversations. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): ConversationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/** Creates a mutation repository over run admission's final transaction. */
function _createMutationRepository(transaction: RunAdmissionTransaction): PrismaConversationMutationRepository
{
	return new PrismaConversationMutationRepository(transaction.prisma);
}

/** Composes the Prisma-backed participant conversation router. */
export function _CreateSelfConversationsRouter(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, createAttachmentAdmission: ConversationAttachmentAdmissionFactory, logger: Logger): Router
{
	const messageAdmission = new PrismaConversationMessageAdmissionUnitOfWork(prisma, runAdmission, _createMutationRepository, createAttachmentAdmission);
	const authority = new PrismaConversationUnitOfWork(prisma, messageAdmission);
	return __CreateSelfConversationsRouter({ resolveCaller: _resolveCaller, authority, logger });
}
