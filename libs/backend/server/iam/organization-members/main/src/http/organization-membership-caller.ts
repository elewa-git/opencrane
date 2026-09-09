import type { Request } from "express";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { OrganizationMembershipCaller } from "../authority.types";

/** Resolves organisation-member identity from the verified session and trusted request host. */
export function _ResolveOrganizationMembershipCaller(request: Request): OrganizationMembershipCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	const authUser = request.session?.authUser;
	if (principal === null || authUser === undefined)
		return null;
	const email = authUser.emailVerified === true && typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : null;
	const displayName = typeof authUser.name === "string" && authUser.name.trim().length > 0 ? authUser.name.trim() : email ?? principal.externalSubject;
	return { siloId: principal.siloId, principalId: principal.principalId, subjectId: principal.externalSubject, verifiedEmail: email, displayName };
}
