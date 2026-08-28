import { ChangeDetectionStrategy, Component, computed, effect, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { Button } from "primeng/button";
import { Card } from "primeng/card";

import { ControlPlaneApiService } from "@opencrane/core";
import { SessionStore } from "@opencrane/state/core";

import { _SafeLoginReturnTo } from "./login-return-to";

/**
 * Public sign-in landing for the operator app.
 *
 * Rendered when the session is anonymous; clicking "Log in" hands off to the
 * deployment-selected login flow with the guarded same-origin `returnTo` path, so the
 * user lands back on the route that required authentication and the access
 * guard re-runs against a fresh session. While session identity is still loading the
 * page renders nothing. Once it resolves, an already-authenticated session is
 * continued to that same path without forcing a second login click.
 * Anonymous invitation routes add the OIDC `prompt=create` value, which makes
 * this page offer provider-hosted registration while retaining an explicit login path.
 *
 * @see https://zitadel.com/docs/apis/openidoauth/endpoints for ZITADEL's `prompt=create` extension.
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

	/** Typed opencrane-ui client that launches the deployment-selected sign-in flow. */
	private readonly _api = inject(ControlPlaneApiService);

	/** Public login route containing the guarded same-origin continuation URL. */
	private readonly _route = inject(ActivatedRoute);

	/** Validated same-origin path used by both automatic and explicit login continuation. */
	private readonly _returnTo = _SafeLoginReturnTo(this._route.snapshot.queryParamMap.get("returnTo"));

	/**
	 * Tells the template whether to present account creation before ordinary login.
	 *
	 * The value is true only for ZITADEL's exact `prompt=create` extension. The guarded invitation
	 * route supplies it; arbitrary prompt spellings leave the ordinary login page unchanged.
	 *
	 * Called by: the invite-state branch in `login-page.component.html`.
	 */
	public readonly registrationRequested = this._route.snapshot.queryParamMap.get("prompt") === "create";

	/** Whether the landing card should be shown — once session identity is no longer
	 * loading and the session is anonymous. Reading `isLoading` (rather than
	 * `hasValue`) means an errored live gateway (backend unreachable) still
	 * surfaces the login affordance instead of staring at a blank page. */
	public readonly showShell = computed(function _showShell(this: LoginPageComponent): boolean
	{
		return !this._session.me.isLoading() && !this._session.authenticated();
	}.bind(this));

	public constructor()
	{
		const session = this._session;
		const router = this._router;
		const returnTo = this._returnTo;

		// An already-signed-in visitor (refresh, bookmark, manual nav) should not
		// see the login card — bounce them to `/` so the access guard decides
		// whether they reach the workspace or the no-tenant screen.
		effect(function _redirectIfAlreadyAuthenticated(): void
		{
			if (!session.me.hasValue())
			{
				return;
			}
			if (session.authenticated())
			{
				void router.navigateByUrl(returnTo);
			}
		});
	}

	/**
	 * Sends an existing user through the selected login flow with the validated continuation path.
	 *
	 * Called by: the `Log in` actions in `login-page.component.html`.
	 */
	public signIn(): void
	{
		this._api.signIn(this._returnTo);
	}

	/**
	 * Sends a new invitee to provider-hosted registration with the validated invitation path.
	 *
	 * The shared API client performs the browser redirect and does nothing during server-side
	 * rendering. The guarded acceptance store, rather than this login page, owns token consumption.
	 *
	 * Called by: the `Create account` action in `login-page.component.html`.
	 * @see OrganizationInviteAcceptanceStore
	 */
	public signUp(): void
	{
		this._api.signUp(this._returnTo);
	}
}
