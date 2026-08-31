import type { Request } from "express";
import type { PrismaClient } from "@prisma/client";

import { FleetOrganizationMembershipAuthority, HmacOrganizationInvitationTokenAuthority, OrganizationMembershipDeploymentModes, PrismaOrganizationMemberUnitOfWork, StandaloneOrganizationMembershipAuthority, _CreateOrganizationMembersRouter, _CreateOrganizationProductAccessMiddleware, type OrganizationMembershipCaller } from "@opencrane/backend/server/iam/organization-members";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { FleetOrganizationMembershipHttpClient } from "@opencrane/backend/server/infra/organization-membership-gateway";

import type { OpenCraneOrganizationMembershipConfig } from "./config.types";
import type { OrganizationMembersComposition } from "./organization-members-composition.types";

/** Resolves organisation-member identity from the verified session and trusted request host. */
function _resolveCaller(request: Request): OrganizationMembershipCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	const authUser = request.session?.authUser;
	if (principal === null || authUser === undefined) return null;
	const email = authUser.emailVerified === true && typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : null;
	const displayName = typeof authUser.name === "string" && authUser.name.trim().length > 0 ? authUser.name.trim() : email ?? principal.externalSubject;
	return { siloId: principal.siloId, principalId: principal.principalId, subjectId: principal.externalSubject, verifiedEmail: email, displayName };
}

/**
 * Composes exactly one deployment-selected organisation membership authority.
 *
 * Fleet receives no Prisma repository, so transport failure cannot fall back to local rows. The
 * standalone branch receives no Fleet client. Browser requests reach only the returned router and
 * therefore cannot select either branch.
 *
 * Called by: apps/opencrane/src/app/public-app.ts.
 * @param prisma - Silo database client used only by standalone mode.
 * @param config - Startup-frozen deployment configuration.
 * @returns Authenticated member routes plus the optional standalone product-access gate.
 */
export function _CreateOrganizationMembersComposition(prisma: PrismaClient, config: OpenCraneOrganizationMembershipConfig): OrganizationMembersComposition
{
	if (config.mode === OrganizationMembershipDeploymentModes.Fleet)
	{
		const transport = new FleetOrganizationMembershipHttpClient(config.fleet);
		return { router: _CreateOrganizationMembersRouter(new FleetOrganizationMembershipAuthority(transport, config.fleet.credentialSiloId), _resolveCaller), productAccess: null };
	}
	const repository = new PrismaOrganizationMemberUnitOfWork(prisma);
	const tokens = new HmacOrganizationInvitationTokenAuthority(config.standalone.invitationSigningKey);
	return {
		router: _CreateOrganizationMembersRouter(new StandaloneOrganizationMembershipAuthority(repository, tokens, config.standalone), _resolveCaller),
		productAccess: _CreateOrganizationProductAccessMiddleware(repository, _resolveCaller),
	};
}
