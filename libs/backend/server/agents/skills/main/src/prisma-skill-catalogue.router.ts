import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";

import { PrismaSkillAuthorityRepository } from "./prisma-skill-authority.js";
import { __CreateSkillCatalogueRouter } from "./skill-catalogue.router.js";
import type { SkillCatalogueCaller } from "./skill-catalogue.router.types.js";

/** Maps authenticated request facts to the caller contract owned by the skill catalogue. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SkillCatalogueCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed authenticated skill catalogue router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured skill catalogue router.
 */
export function _CreateSkillCatalogueRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSkillCatalogueRouter({
		resolveCaller: _resolveCaller,
		catalogue: new PrismaSkillAuthorityRepository(prisma),
		logger,
	});
}
