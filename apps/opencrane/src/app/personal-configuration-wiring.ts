import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreatePersonalConfigurationRouter, PrismaPersonalConfigurationChangeRepository, type PersonalConfigurationCaller } from "@opencrane/backend/agents/personal/configuration";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Compose the owner-only personal configuration proposal state API. */
export function _CreatePersonalConfigurationRouter(prisma: PrismaClient): Router
{
	const changes = new PrismaPersonalConfigurationChangeRepository(prisma, _log);
	return __CreatePersonalConfigurationRouter({ resolveCaller: _resolveCaller, changes, decisions: changes, materializer: changes, clock: { now(): Date { return new Date(); } }, logger: _log });
}

/** Derive the proposal owner from the signed-in browser session and trusted host silo. */
function _resolveCaller(request: Request): PersonalConfigurationCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const userId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return userId && siloId ? { userId, siloId } : null;
}
