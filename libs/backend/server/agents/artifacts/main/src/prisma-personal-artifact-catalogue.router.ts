import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { __CreatePersonalArtifactCatalogueRouter } from "./personal-artifact-catalogue.router";
import type { PersonalArtifactCaller } from "./personal-artifact-catalogue.router.types";
import { PrismaPersonalArtifactCatalogueUnitOfWork } from "./prisma-personal-artifact-catalogue-unit-of-work";

/** Maps authenticated request facts to the caller contract owned by the artifact catalogue. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonalArtifactCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { ownerPrincipalId: principal.principalId, siloId: principal.siloId } : null;
}

/**
 * Build the personal asset catalogue router with its Prisma repository already wired in.
 *
 * The app only has to supply the database client and a logger; the caller resolver and the
 * read-only repository are chosen here.
 *
 * Called by: apps/opencrane/src/app/routes.ts, which mounts the result at `/api/v1/me/assets`.
 *
 * @param prisma - The product database client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns An Express router ready to mount under the authenticated public API.
 */
export function _CreatePersonalArtifactCatalogueRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreatePersonalArtifactCatalogueRouter({
		resolveCaller: _resolveCaller,
		catalogue: new PrismaPersonalArtifactCatalogueUnitOfWork(prisma),
		logger,
	});
}
