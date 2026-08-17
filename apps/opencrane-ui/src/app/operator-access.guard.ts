import { Injector, computed, inject } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from "@angular/router";
import { filter, firstValueFrom } from "rxjs";

import { SessionStore } from "@opencrane/state/core";

/**
 * Gate for every authenticated operator route.
 *
 * Resolves async so navigation waits for `/auth/me` to settle before deciding; otherwise a
 * cold guard would see `hasValue() === false` and either flash the wrong
 * destination or loop the redirects. The decision matrix once both resources
 * settle:
 *
 * - anonymous session → redirect to `/login`
 * - authenticated session → allow activation
 *
 * Wide-scope (`___`) prefix because feature/app libs consume it directly.
 */
export const ___OperatorAccessGuard: CanActivateFn = async function ___OperatorAccessGuard(_route, state: RouterStateSnapshot): Promise<boolean | UrlTree>
{
	const session = inject(SessionStore);
	const router = inject(Router);
	const injector = inject(Injector);

	// Wait for `/auth/me` to settle (no longer loading). Reading `isLoading`
	// inside a `computed` makes the wait reactive — the guard resumes the
	// moment the resource transitions out of its loading state, whether it
	// resolved with a value or threw.
	const meSettled = computed(function _meSettled(): boolean
	{
		return !session.me.isLoading();
	});
	await firstValueFrom(toObservable(meSettled, { injector }).pipe(filter(Boolean)));

	if (!session.authenticated())
	{
		// Carry the exact Angular-owned same-origin URL through the public login route. Invitation tokens
		// stay in the URL long enough to survive OIDC, but are never written to local or session storage;
		// the acceptance route replaces the token-bearing URL before its API call.
		return router.createUrlTree(["/login"], { queryParams: { returnTo: state.url } });
	}

	return true;
};
