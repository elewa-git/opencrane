import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreateDeferredToolApprovalRouter, PrismaDeferredToolApprovalDecisionRepository, type DeferredToolApprovalCaller } from "@opencrane/backend/server/iam/authorization";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Builds the app-composed self-only deferred-tool approval decision API. */
export function _CreateDeferredToolApprovalRouter(prisma: PrismaClient): Router
{
	return __CreateDeferredToolApprovalRouter({
		resolveCaller: _resolveCaller,
		decisions: new PrismaDeferredToolApprovalDecisionRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}

/** Resolves the self-only approval owner from session identity and the request host's silo. */
function _resolveCaller(request: Request): DeferredToolApprovalCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const subjectId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return subjectId && siloId ? { subjectId, siloId } : null;
}
