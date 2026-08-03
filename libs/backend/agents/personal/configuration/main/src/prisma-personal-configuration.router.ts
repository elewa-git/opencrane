import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/server/_infra/auth";

import { _PersonalConfigurationMaterializer } from "./materialization/personal-configuration-materializer.js";
import { PrismaPersonalConfigurationMaterializationUnitOfWork } from "./materialization/prisma-personal-configuration-materialization-unit-of-work.js";
import { __CreatePersonalConfigurationRouter } from "./http/personal-configuration.router.js";
import type { PersonalConfigurationCaller } from "./http/personal-configuration.router.types.js";
import { PrismaPersonalConfigurationDecisionRepository } from "./decision/prisma-personal-configuration-decision-repository.js";
import { PrismaPersonalConfigurationViewRepository } from "./query/prisma-personal-configuration-view-repository.js";

/** Maps authenticated request facts to the caller contract owned by personal configuration. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonalConfigurationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { userId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed owner-only personal configuration router.
 * @param prisma - Canonical product-authority client.
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
