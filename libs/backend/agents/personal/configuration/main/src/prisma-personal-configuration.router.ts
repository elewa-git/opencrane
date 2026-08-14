import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { _PersonalConfigurationMaterializer } from "./materialization/personal-configuration-materializer";
import { PrismaPersonalConfigurationMaterializationUnitOfWork } from "./materialization/prisma-personal-configuration-materialization-unit-of-work";
import { __CreatePersonalConfigurationRouter } from "./http/personal-configuration.router";
import type { PersonalConfigurationCaller } from "./http/personal-configuration.router.types";
import { PrismaPersonalConfigurationDecisionRepository } from "./decision/prisma-personal-configuration-decision-repository";
import { PrismaPersonalConfigurationViewRepository } from "./query/prisma-personal-configuration-view-repository";

/** Turns the authenticated request into the caller shape this package uses, or null when there is no session. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonalConfigurationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { userId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Builds the personal configuration router, where a user can only read and change their own
 * proposals.
 *
 * Wires the three routes to their repositories and to a clock, so no route ever takes an owner
 * id or a timestamp from the request. Mounted at `/api/v1/me/configuration`.
 *
 * Called by: `routes.ts` in apps/opencrane/src/app.
 *
 * @param prisma - Product database client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured personal configuration router.
 */
export function _CreatePersonalConfigurationRouter(prisma: PrismaClient, logger: Logger): Router
{
	const materializer = new _PersonalConfigurationMaterializer(new PrismaPersonalConfigurationMaterializationUnitOfWork(prisma), logger);
	return __CreatePersonalConfigurationRouter({
		resolveCaller: _resolveCaller,
		changes: new PrismaPersonalConfigurationViewRepository(prisma),
		decisions: new PrismaPersonalConfigurationDecisionRepository(prisma, logger),
		materializer,
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
