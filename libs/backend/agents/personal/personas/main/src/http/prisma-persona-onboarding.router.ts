import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "@opencrane/backend/observability";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";
import { __CreatePersonaOnboardingRouter } from "./persona-onboarding.router.js";
import type { PersonaOnboardingCaller, PersonaOnboardingWorkflowPort } from "./persona-onboarding.router.types.js";
import { PrismaPersonaPersistenceUnitOfWork } from "../profile/prisma-persona-persistence-unit-of-work.js";

/** Maps authenticated request facts to the caller contract owned by persona onboarding. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonaOnboardingCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { userId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed self-only persona onboarding router.
 * This is the sole persistence composition seam for the persona HTTP boundary. It constructs one
 * aggregate unit of work and supplies it through lifecycle-specific ports. The unit of work creates
 * each repository inside its exact transaction callback, while the route-level router remains
 * dependent only on ports.
 *
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured persona onboarding router.
 */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient, logger: Logger, workflow: PersonaOnboardingWorkflowPort): Router
{
	const persistence = new PrismaPersonaPersistenceUnitOfWork(prisma, logger);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: _resolveCaller,
		onboarding: persistence,
		interviews: persistence,
		questions: persistence,
		drafts: persistence,
		approval: persistence,
		clock: { now(): Date { return new Date(); } },
		logger,
		status: persistence,
		workflow,
	});
}
