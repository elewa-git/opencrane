import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";

import { __CreatePersonalArtifactCatalogueRouter } from "./personal-artifact-catalogue.router.js";
import type { PersonalArtifactCaller } from "./personal-artifact-catalogue.router.types.js";
import { _CreateArtifactCatalogueRepository } from "./prisma-artifact-authority.composition.js";

/** Maps authenticated request facts to the caller contract owned by the artifact catalogue. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonalArtifactCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { ownerPrincipalId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed owner-only personal artifact catalogue router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured personal artifact catalogue router.
 */
export function _CreatePersonalArtifactCatalogueRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreatePersonalArtifactCatalogueRouter({
		resolveCaller: _resolveCaller,
		catalogue: _CreateArtifactCatalogueRepository(prisma),
		logger,
	});
}
