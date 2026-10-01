import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { UserOnboardingOwnerResolver } from "../user-onboarding.http.types";

/** Resolve the onboarding owner only from the authenticated user on the request, never from the request body. */
export const _ResolveUserOnboardingOwner: UserOnboardingOwnerResolver = function _Owner(request)
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, subjectId: principal.externalSubject };
};
