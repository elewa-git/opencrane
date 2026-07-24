import type { PrismaClient } from "@prisma/client";
import type { Request, Router } from "express";

import { PrismaPersonaAuthorityRepository, PrismaPersonaDraftRepository, PrismaPersonaInterviewRepository, PrismaPersonaOnboardingRepository, __CreatePersonaOnboardingRouter } from "@opencrane/backend/agents/personal/personas";

import { _log } from "./log.js";
import { _ResolveActivePersonalCaller } from "./personal-owner-wiring.js";

/** Compose the app's thin authenticated persona-onboarding route with canonical Prisma authorities. */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient): Router
{
	const onboarding = new PrismaPersonaOnboardingRepository(prisma);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: function _ResolveCaller(request: Request) { return _ResolveActivePersonalCaller(prisma, request); },
		profiles: onboarding,
		source: onboarding,
		interviews: new PrismaPersonaInterviewRepository(prisma),
		drafts: new PrismaPersonaDraftRepository(prisma),
		personas: new PrismaPersonaAuthorityRepository(prisma),
		clock: { now: function _Now(): Date { return new Date(); } },
		logger: _log,
	});
}
