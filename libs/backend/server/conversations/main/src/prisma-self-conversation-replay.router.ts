import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { _CreateConversationReplayRepository } from "./prisma-conversation-replay.composition.js";
import { __CreateSelfConversationReplayRouter } from "./self-conversation-replay.router.js";
import type { SelfConversationReplayCaller } from "./self-conversation-replay.router.types.js";

/** Maps authenticated request facts to the caller contract owned by conversations. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfConversationReplayCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed participant-bound conversation replay router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured self-conversation replay router.
 */
export function _CreateSelfConversationReplayRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSelfConversationReplayRouter({
		resolveCaller: _resolveCaller,
		repository: _CreateConversationReplayRepository(prisma),
		logger,
	});
}
