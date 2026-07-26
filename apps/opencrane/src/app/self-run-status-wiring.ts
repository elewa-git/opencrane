import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreateSelfRunStatusRouter, PrismaSelfRunStatusRepository, type SelfRunStatusCaller } from "@opencrane/backend/agents/execution/runs";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Build the app-composed self-only personal run status API. */
export function _CreateSelfRunStatusRouter(prisma: PrismaClient): Router
{
	return __CreateSelfRunStatusRouter({ resolveCaller: _resolveCaller, repository: new PrismaSelfRunStatusRepository(prisma), logger: _log });
}

/** Derive the run owner from the session and host-selected silo. */
function _resolveCaller(request: Request): SelfRunStatusCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const subjectId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return subjectId && siloId ? { subjectId, siloId } : null;
}
