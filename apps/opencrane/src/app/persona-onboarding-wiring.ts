import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreatePersonaOnboardingRouter, PrismaPersonaAuthorityRepository, PrismaPersonaDraftRepository, PrismaPersonaInterviewRepository, PrismaPersonaOnboardingRepository } from "@opencrane/backend/agents/personal/personas";

import { _log } from "./log.js";
import { _ResolvePersonalSelfCaller } from "./personal-self-caller.js";

/** Builds the app-composed self-only persona onboarding API. */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient): Router
{
	const interviews = new PrismaPersonaInterviewRepository(prisma);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: _ResolvePersonalSelfCaller,
		onboarding: new PrismaPersonaOnboardingRepository(prisma, _log),
		interviews,
		questions: interviews,
		drafts: new PrismaPersonaDraftRepository(prisma),
		approval: new PrismaPersonaAuthorityRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}
