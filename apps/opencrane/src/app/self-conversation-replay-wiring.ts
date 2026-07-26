import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreateSelfConversationReplayRouter, PrismaConversationReplayRepository, type SelfConversationReplayCaller } from "@opencrane/backend/server/agents/conversation-replay";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Build the session-authenticated, participant-bound canonical conversation replay API. */
export function _CreateSelfConversationReplayRouter(prisma: PrismaClient): Router
{
	return __CreateSelfConversationReplayRouter({ resolveCaller: _resolveCaller, repository: new PrismaConversationReplayRepository(prisma), logger: _log });
}

/** Derive the caller solely from the session and host-selected silo. */
function _resolveCaller(request: Request): SelfConversationReplayCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const subjectId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return subjectId && siloId ? { subjectId, siloId } : null;
}
