import { Injector, computed, inject } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { CanActivateFn, Router, UrlTree } from "@angular/router";
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
export const ___OperatorAccessGuard: CanActivateFn = async function ___OperatorAccessGuard(): Promise<boolean | UrlTree>
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
		return router.parseUrl("/login");
	}

	return true;
};
