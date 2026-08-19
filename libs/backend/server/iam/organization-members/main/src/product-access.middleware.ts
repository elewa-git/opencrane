import type { RequestHandler } from "express";

import type { OrganizationMembershipCallerResolver } from "./authority.types";
import type { OrganizationMemberRepository } from "./organization-member-repository.types";

/** Exact authenticated route that may create membership for a signed invitation recipient. */
const _INVITATION_ACCEPTANCE_PATH = "/api/v1/organization/members/invitations/accept";

/**
 * Gates standalone product routes on current active membership after OIDC authentication.
 *
 * Invitation acceptance is the sole pre-membership product exception. It still verifies the signed
 * token, provider-verified email, subject, and host-selected silo before creating membership. A
 * repository failure reaches the shared error handler instead of being mistaken for membership.
 *
 * Called by: `_CreateOrganizationMembersComposition` in apps/opencrane.
 * @param repository - Standalone membership authority backed by the silo database.
 * @param resolveCaller - Derives the verified subject and silo only from the request session and host.
 * @returns Express middleware that permits active members and the exact acceptance route.
 */
export function _CreateOrganizationProductAccessMiddleware(repository: OrganizationMemberRepository, resolveCaller: OrganizationMembershipCallerResolver): RequestHandler
{
	return async function _RequireCurrentMembership(request, response, next): Promise<void>
	{
		if (request.path === "/healthz" || (request.method === "POST" && request.path === _INVITATION_ACCEPTANCE_PATH))
		{
			next();
			return;
		}
		const caller = resolveCaller(request);
		if (caller === null)
		{
			response.status(403).json({ error: "active organization membership is required", code: "MEMBERSHIP_REQUIRED" });
			return;
		}
		try
		{
			if (await repository.hasActiveMembership(caller))
			{
				next();
				return;
			}
			response.status(403).json({ error: "active organization membership is required", code: "MEMBERSHIP_REQUIRED" });
		}
		catch (error)
		{
			next(error);
		}
	};
}
