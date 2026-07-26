import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreatePersonalArtifactCatalogueRouter, PrismaArtifactAuthorityRepository, type PersonalArtifactCaller } from "@opencrane/backend/server/agents/artifacts";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Compose the authenticated, owner-only personal asset catalogue API. */
export function _CreatePersonalArtifactCatalogueRouter(prisma: PrismaClient): Router
{
	return __CreatePersonalArtifactCatalogueRouter({ resolveCaller: _resolveCaller, catalogue: new PrismaArtifactAuthorityRepository(prisma), logger: _log });
}

/** Derive the owner and silo only from the signed-in browser session and trusted request host. */
function _resolveCaller(request: Request): PersonalArtifactCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const ownerPrincipalId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return ownerPrincipalId && siloId ? { ownerPrincipalId, siloId } : null;
}
