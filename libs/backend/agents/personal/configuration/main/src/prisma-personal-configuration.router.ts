import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/server/_infra/auth";

import { _PersonalConfigurationMaterializer } from "./materialization/personal-configuration-materializer.js";
import { PrismaPersonalConfigurationMaterializationUnitOfWork } from "./materialization/prisma-personal-configuration-materialization-unit-of-work.js";
import { __CreatePersonalConfigurationRouter } from "./personal-configuration.router.js";
import type { PersonalConfigurationCaller } from "./personal-configuration.router.types.js";
import { PrismaPersonalConfigurationChangeRepository } from "./prisma-personal-configuration-repository.js";

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
	const changes = new PrismaPersonalConfigurationChangeRepository(prisma, logger);
	const materializer = new _PersonalConfigurationMaterializer(new PrismaPersonalConfigurationMaterializationUnitOfWork(prisma), logger);
	return __CreatePersonalConfigurationRouter({
		resolveCaller: _resolveCaller,
		changes,
		decisions: changes,
		materializer,
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
