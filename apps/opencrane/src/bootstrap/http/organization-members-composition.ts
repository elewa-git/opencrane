import { _ResolveOrganizationMembershipCaller } from "@opencrane/backend/server/iam/organization-members";

import type { PrismaClient } from "@prisma/client";

import { FleetOrganizationMembershipAuthority, HmacOrganizationInvitationTokenAuthority, OrganizationMembershipDeploymentModes, PrismaOrganizationMemberUnitOfWork, StandaloneOrganizationMembershipAuthority, _CreateOrganizationMembersRouter, _CreateOrganizationProductAccessMiddleware } from "@opencrane/backend/server/iam/organization-members";

import { FleetOrganizationMembershipHttpClient } from "@opencrane/backend/server/infra/organization-membership-gateway";

import type { OpenCraneOrganizationMembershipConfig } from "../configuration/config.types";
import type { OrganizationMembersComposition } from "./organization-members-composition.types";

/**
 * Composes exactly one deployment-selected organisation membership authority.
 *
 * Fleet receives no Prisma repository, so transport failure cannot fall back to local rows. The
 * standalone branch receives no Fleet client. Browser requests reach only the returned router and
 * therefore cannot select either branch.
 *
 * Called by: apps/opencrane/src/bootstrap/http/public-app.ts.
 * @param prisma - Silo database client used only by standalone mode.
 * @param config - Startup-frozen deployment configuration.
 * @returns Authenticated member routes plus the optional standalone product-access gate.
 */
export function _CreateOrganizationMembersComposition(prisma: PrismaClient, config: OpenCraneOrganizationMembershipConfig): OrganizationMembersComposition
{
	if (config.mode === OrganizationMembershipDeploymentModes.Fleet)
	{
		const transport = new FleetOrganizationMembershipHttpClient(config.fleet);
		return { router: _CreateOrganizationMembersRouter(new FleetOrganizationMembershipAuthority(transport, config.fleet.credentialSiloId), _ResolveOrganizationMembershipCaller), productAccess: null };
	}
	const repository = new PrismaOrganizationMemberUnitOfWork(prisma);
	const tokens = new HmacOrganizationInvitationTokenAuthority(config.standalone.invitationSigningKey);
	return {
		router: _CreateOrganizationMembersRouter(new StandaloneOrganizationMembershipAuthority(repository, tokens, config.standalone), _ResolveOrganizationMembershipCaller),
		productAccess: _CreateOrganizationProductAccessMiddleware(repository, _ResolveOrganizationMembershipCaller),
	};
}
