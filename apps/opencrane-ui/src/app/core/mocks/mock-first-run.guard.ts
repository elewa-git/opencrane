import { inject } from "@angular/core";
import { CanActivateFn, Router, UrlTree } from "@angular/router";

import { MockIdentityService } from "./mock-identity.service.js";

/** Mock-build first-run guard driven entirely by deterministic access state. */
export const ___MockFirstRunGuard: CanActivateFn = function ___MockFirstRunGuard(): boolean | UrlTree
{
	return inject(MockIdentityService).access().firstRun ? inject(Router).parseUrl("/welcome") : true;
};
