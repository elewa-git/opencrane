import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "@opencrane/backend/observability";

import { _ResolveRequestPrincipal } from "@opencrane/backend/_server/auth";
import { PrismaPersonalConfigurationPersonaRefreshUnitOfWork } from "@opencrane/backend/agents/personal/configuration";

import { __CreatePersonaOnboardingRouter } from "./persona-onboarding.router.js";
import type { PersonaOnboardingCaller } from "./persona-onboarding.router.types.js";
import { PrismaPersonaAuthorityRepository } from "../approval/prisma-persona-authority-repository.js";
import { PrismaPersonaDraftRepository } from "../drafting/prisma-persona-draft-repository.js";
import { PrismaPersonaInterviewRepository } from "../interview/prisma-persona-interview-repository.js";
import { PrismaPersonaOnboardingRepository } from "../profile/prisma-persona-onboarding-repository.js";
import { PrismaPersonaOnboardingStatusRepository } from "../profile/prisma-persona-onboarding-status-repository.js";
import { PrismaPersonaPersistenceUnitOfWork } from "../profile/prisma-persona-persistence-unit-of-work.js";

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
	const refreshes = new PrismaPersonalConfigurationPersonaRefreshUnitOfWork(prisma);
	const transactions = new PrismaPersonaPersistenceUnitOfWork(prisma);
	const interviews = new PrismaPersonaInterviewRepository(prisma, refreshes, transactions, logger);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: _resolveCaller,
		onboarding: new PrismaPersonaOnboardingRepository(logger, transactions),
		interviews,
		questions: interviews,
		drafts: new PrismaPersonaDraftRepository(prisma, transactions, logger),
		approval: new PrismaPersonaAuthorityRepository(prisma, refreshes),
		clock: { now(): Date { return new Date(); } },
		logger,
		status: new PrismaPersonaOnboardingStatusRepository(prisma),
	});
}
