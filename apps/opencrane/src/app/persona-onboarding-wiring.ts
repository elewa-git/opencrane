import type { Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { __CreatePersonaOnboardingRouter, PrismaPersonaAuthorityRepository, PrismaPersonaDraftRepository, PrismaPersonaInterviewRepository, PrismaPersonaOnboardingRepository, type PersonaOnboardingCaller } from "@opencrane/backend/agents/personal/personas";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Builds the app-composed self-only persona onboarding API. */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient): Router
{
	const interviews = new PrismaPersonaInterviewRepository(prisma);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: _resolveCaller,
		onboarding: new PrismaPersonaOnboardingRepository(prisma, _log),
		interviews,
		questions: interviews,
		drafts: new PrismaPersonaDraftRepository(prisma),
		approval: new PrismaPersonaAuthorityRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger: _log,
	});
}

/** Resolves the self-only persona owner from session identity and the request host's silo. */
function _resolveCaller(request: Request): PersonaOnboardingCaller | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const userId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return userId && siloId ? { userId, siloId } : null;
}
