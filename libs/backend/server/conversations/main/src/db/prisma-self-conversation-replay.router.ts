import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { CONVERSATION_PROJECTION_CLOCK, CONVERSATION_PROJECTION_LIMITS } from "@opencrane/backend/conversations/projection";

import { _CreateConversationReplayRepository } from "./prisma-conversation-replay.composition.js";
import { __CreateSelfConversationReplayRouter } from "../self-conversation-replay.router.js";
import type { SelfConversationReplayCaller, SelfConversationReplayCompositionOptions } from "../self-conversation-replay.router.types.js";

/** Maps authenticated request facts to the caller contract owned by conversations. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SelfConversationReplayCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Build the ready-to-mount live replay router for an app, wired to the production clock and
 * limits.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/me/conversations`, which
 * also supplies the approval-overlay reader and the shutdown signal.
 *
 * @param prisma - Product database client; one short transaction is opened per page read.
 * @param logger - Used only for unexpected stream failures; never receives event content.
 * @param options - Optional approval-overlay reader and process shutdown signal. Leave them
 *   out and the stream carries stored events only and is not drained on shutdown.
 * @returns An Express router carrying the events route.
 */
export function _CreateSelfConversationReplayRouter(prisma: PrismaClient, logger: Logger, options: SelfConversationReplayCompositionOptions = {}): Router
{
	return __CreateSelfConversationReplayRouter({
		resolveCaller: _resolveCaller,
		repository: _CreateConversationReplayRepository(prisma),
		clock: CONVERSATION_PROJECTION_CLOCK,
		limits: CONVERSATION_PROJECTION_LIMITS,
		...(options.interrupts === undefined ? {} : { interrupts: options.interrupts }),
		...(options.shutdownSignal === undefined ? {} : { shutdownSignal: options.shutdownSignal }),
		logger,
	});
}
