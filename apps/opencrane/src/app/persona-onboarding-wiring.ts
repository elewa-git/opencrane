import { OrgMemberStatus, type PrismaClient } from "@prisma/client";
import type { Request, Router } from "express";

import { PrismaPersonaAuthorityRepository, PrismaPersonaDraftRepository, PrismaPersonaInterviewRepository, PrismaPersonaOnboardingRepository, __CreatePersonaOnboardingRouter, type PersonaOnboardingCaller } from "@opencrane/backend/agents/personal/personas";
import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session `SessionData.authUser` augmentation.
import "@opencrane/server/_infra/auth";

import { _log } from "./log.js";

/** Resolve an active personal member from the authenticated session and host-derived ClusterTenant silo. */
async function _resolveCaller(prisma: PrismaClient, request: Request): Promise<PersonaOnboardingCaller | null>
{
	const authUser = request.session?.authUser;
	const userId = typeof authUser?.sub === "string" ? authUser.sub.trim() : "";
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	if (!userId || !siloId) return null;
	try
	{
		const membership = await prisma.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: siloId, subject: userId } }, select: { status: true } });
		return membership?.status === OrgMemberStatus.Active ? { userId, siloId } : null;
	}
	catch (err)
	{
		throw err;
	}
}

/** Compose the app's thin authenticated persona-onboarding route with canonical Prisma authorities. */
export function _CreatePersonaOnboardingRouter(prisma: PrismaClient): Router
{
	const onboarding = new PrismaPersonaOnboardingRepository(prisma);
	return __CreatePersonaOnboardingRouter({
		resolveCaller: function _ResolveCaller(request: Request): Promise<PersonaOnboardingCaller | null> { return _resolveCaller(prisma, request); },
		profiles: onboarding,
		source: onboarding,
		interviews: new PrismaPersonaInterviewRepository(prisma),
		drafts: new PrismaPersonaDraftRepository(prisma),
		personas: new PrismaPersonaAuthorityRepository(prisma),
		clock: { now: function _Now(): Date { return new Date(); } },
		logger: _log,
	});
}
