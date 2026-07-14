import { inject } from "@angular/core";
import { CanActivateFn, Router, UrlTree } from "@angular/router";

import { MockIdentityService } from "./mock-identity.service.js";

/** Mock-build access guard that never invokes OIDC or live tenant state. */
export const ___MockAccessGuard: CanActivateFn = function ___MockAccessGuard(): boolean | UrlTree
{
	const access = inject(MockIdentityService).access();
	const router = inject(Router);
	if (!access.authenticated)
	{
		return router.parseUrl("/login");
	}
	if (!access.tenantId)
	{
		return router.parseUrl("/no-tenant");
	}
	return true;
};
