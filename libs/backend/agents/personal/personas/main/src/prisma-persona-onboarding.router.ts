import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";

import { __CreatePersonaOnboardingRouter } from "./persona-onboarding.router.js";
import type { PersonaOnboardingCaller } from "./persona-onboarding.router.types.js";
import { PrismaPersonaAuthorityRepository } from "./prisma-persona-authority-repository.js";
import { PrismaPersonaDraftRepository } from "./prisma-persona-draft-repository.js";
import { PrismaPersonaInterviewRepository } from "./prisma-persona-interview-repository.js";
import { PrismaPersonaOnboardingRepository } from "./prisma-persona-onboarding-repository.js";
import { PrismaPersonaOnboardingStatusRepository } from "./prisma-persona-onboarding-status-repository.js";

/** Maps authenticated request facts to the caller contract owned by persona onboarding. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): PersonaOnboardingCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { userId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed self-only persona onboarding router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured persona onboarding router.
 */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient, logger: Logger): Router
{
	const interviews = new PrismaPersonaInterviewRepository(prisma);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: _resolveCaller,
		onboarding: new PrismaPersonaOnboardingRepository(prisma, logger),
		interviews,
		questions: interviews,
		drafts: new PrismaPersonaDraftRepository(prisma),
		approval: new PrismaPersonaAuthorityRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger,
		status: new PrismaPersonaOnboardingStatusRepository(prisma),
	});
}
