import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from "@angular/core";
import { Router } from "@angular/router";
import { Button } from "primeng/button";
import { Card } from "primeng/card";

import { ControlPlaneApiService } from "@opencrane/core";
import { SessionStore } from "@opencrane/state/core";

/**
 * Public sign-in landing for the operator app.
 *
 * Rendered when the session is anonymous; clicking "Log in" hands off to the
 * opencrane-ui OIDC flow with `returnTo=/`, so the user lands back on the
 * workspace root and the access guard re-runs against a fresh session. While
 * `/auth/me` is still loading the page renders nothing — once it resolves,
 * an already-authenticated session is bounced straight to `/` rather than
 * forcing a second click on a CTA the user has already satisfied.
 */
@Component({
	selector: "wo-login-page",
	standalone: true,
	imports: [Card, Button],
	templateUrl: "./login-page.component.html",
	styleUrl: "./login-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPageComponent
{
	/** App-wide identity/session state. */
	private readonly _session = inject(SessionStore);

	/** Router for the auto-redirect when an authenticated user lands here. */
	private readonly _router = inject(Router);

	/** Typed opencrane-ui client (used to launch the OIDC sign-in flow). */
	private readonly _api = inject(ControlPlaneApiService);

	/** Component lifetime used to remove browser-return listeners. */
	private readonly _destroyRef = inject(DestroyRef);

	/** Whether the landing card should be shown — once `/auth/me` is no longer
	 * loading and the session is anonymous. Reading `isLoading` (rather than
	 * `hasValue`) means an errored `/auth/me` (backend unreachable) still
	 * surfaces the login affordance instead of staring at a blank page. */
	public readonly showShell = computed(this._showShell.bind(this));

	public constructor()
	{
		const session = this._session;
		const router = this._router;

		this._reloadSessionOnBrowserReturn();

		// An already-signed-in visitor (refresh, bookmark, manual nav, or a tab
		// restored after Zitadel completed login elsewhere) should not see the
		// login card — bounce them to `/` so the access guard decides whether
		// they reach the workspace or the no-tenant screen.
		effect(function _redirectIfAlreadyAuthenticated(): void
		{
			if (!session.me.hasValue())
			{
				return;
			}
			if (session.authenticated())
			{
				void router.navigateByUrl("/");
			}
		});
	}

	/** Launches the OIDC sign-in flow, returning to the workspace root. */
	public signIn(): void
	{
		this._api.signIn("/");
	}

	/** Decide whether the anonymous login shell should be visible. */
	private _showShell(): boolean
	{
		return !this._session.me.isLoading() && !this._session.authenticated();
	}

	/** Re-check `/auth/me` when the browser returns from an external login page. */
	private _reloadSessionOnBrowserReturn(): void
	{
		this._session.reload();

		if (typeof window === "undefined" || typeof document === "undefined")
		{
			return;
		}

		const session = this._session;
		const reloadVisibleSession = function _reloadVisibleSession(): void
		{
			if (document.visibilityState === "visible")
			{
				session.reload();
			}
		};

		window.addEventListener("pageshow", reloadVisibleSession);
		window.addEventListener("focus", reloadVisibleSession);
		document.addEventListener("visibilitychange", reloadVisibleSession);

		this._destroyRef.onDestroy(function _removeSessionReloadListeners(): void
		{
			window.removeEventListener("pageshow", reloadVisibleSession);
			window.removeEventListener("focus", reloadVisibleSession);
			document.removeEventListener("visibilitychange", reloadVisibleSession);
		});
	}
}
