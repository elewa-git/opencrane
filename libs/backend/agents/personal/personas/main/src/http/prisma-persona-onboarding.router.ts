import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "@opencrane/backend/observability";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { __CreatePersonaOnboardingRouter } from "./persona-onboarding.router";
import type { PersonaOnboardingCaller, PersonaOnboardingWorkflowPort } from "./persona-onboarding.router.types";
import type { PersonaAgentRevisionSelectionFactory } from "./prisma-persona-onboarding.router.types";
import { PrismaPersonaPersistenceUnitOfWork } from "../profile/prisma-persona-persistence-unit-of-work";

/** Turns the authenticated request principal into the caller shape persona onboarding expects; null when the request is not authenticated. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonaOnboardingCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { userId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Builds the persona onboarding router with its Prisma-backed persistence.
 *
 * This is the only place the persona HTTP routes are wired to Prisma. It builds one unit of work and
 * passes it in as each of the lifecycle ports. The unit of work creates each repository inside its own
 * transaction callback, so the router itself only ever sees ports.
 *
 * Called by: `apps/opencrane/src/app/routes.ts`, which mounts the result at /api/v1/me/persona.
 *
 * @param prisma - Prisma client for the product database.
 * @param logger - Logger supplied by the app's composition root.
 * @param workflow - Port notified after an interview starts and after a persona is approved.
 * @param agentRevisionSelection - App-owned bridge to agent-service revision selection.
 * @returns An Express router to mount below /me/persona.
 * @see PersonaPersistenceUnitOfWork
 */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient, logger: Logger, workflow: PersonaOnboardingWorkflowPort, agentRevisionSelection: PersonaAgentRevisionSelectionFactory): Router
{
	const persistence = new PrismaPersonaPersistenceUnitOfWork(prisma, logger, agentRevisionSelection);
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
