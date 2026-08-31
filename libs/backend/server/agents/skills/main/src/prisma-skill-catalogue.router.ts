import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { PrismaSkillCatalogueUnitOfWork } from "./prisma-skill-catalogue-unit-of-work";
import { __CreateSkillCatalogueRouter } from "./skill-catalogue.router";
import type { SkillCatalogueCaller } from "./skill-catalogue.router.types";

/** Maps authenticated request facts to the caller contract owned by the skill catalogue. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): SkillCatalogueCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { siloId: principal.siloId, principalId: principal.principalId } : null;
}

/**
 * Builds the skill catalogue router with its Prisma-backed reader.
 *
 * Caller resolution comes from the shared request-principal helper, so the silo is taken from the
 * authenticated session and request host and never from anything the caller sends.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/skills`.
 *
 * @param prisma - The OpenCrane Prisma client.
 * @param logger - Process logger from the app's composition root.
 * @returns The router, ready to mount.
 */
export function _CreateSkillCatalogueRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateSkillCatalogueRouter({
		resolveCaller: _resolveCaller,
		catalogue: new PrismaSkillCatalogueUnitOfWork(prisma),
		logger,
	});
}
