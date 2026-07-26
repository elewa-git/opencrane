import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreateSkillCatalogueRouter, PrismaSkillAuthorityRepository, type SkillCatalogueCaller } from "@opencrane/backend/server/agents/skills";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Compose the authenticated, browser-safe governed skill catalogue API. */
export function _CreateSkillCatalogueRouter(prisma: PrismaClient): Router
{
	return __CreateSkillCatalogueRouter({ resolveCaller: _resolveCaller, catalogue: new PrismaSkillAuthorityRepository(prisma), logger: _log });
}

/** Derive only the exact catalogue silo from the signed-in browser session and trusted host. */
function _resolveCaller(request: Request): SkillCatalogueCaller | null
{
	if (!request.session?.authUser) return null;
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return siloId ? { siloId } : null;
}
