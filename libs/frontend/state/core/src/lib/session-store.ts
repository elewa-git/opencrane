import { Injectable, Signal, computed, inject, resource } from "@angular/core";

import { Capabilities, SessionUser } from "./session-store.types";
import { _DeriveCapabilities } from "./session-store.util";
import { PLATFORM_SURFACE } from "./platform-surface";
import { SESSION_GATEWAY, type SessionSnapshot } from "./session-gateway.types";

/**
 * App-wide identity and capability state, sourced through the configured session gateway.
 *
 * Platform and org are strictly-separated domains with their own OIDC sessions
 * (see {@link PLATFORM_SURFACE}), so the app composition selects a gateway that
 * preserves that boundary. All values are signals; capabilities are `computed`
 * so RBAC checks in templates are memoised reads, not method calls.
 */
@Injectable({ providedIn: "root" })
export class SessionStore
{
	/** Session port supplied by the app composition root. */
	private readonly _gateway = inject(SESSION_GATEWAY);

	/** Which strictly-separated surface this app serves — platform vs org (see {@link PLATFORM_SURFACE}). */
	private readonly _surface = inject(PLATFORM_SURFACE);

	/** Current authentication status and identity loaded through the configured gateway. */
	public readonly me = resource({
		loader: this._load.bind(this)
	});

	/** Loads the current session through the injected transport boundary. */
	private _load(): Promise<SessionSnapshot>
	{
		return this._gateway.load(this._surface);
	}

	/** Whether an OpenCrane UI session is established. */
	public readonly authenticated: Signal<boolean> = computed(() =>
	{
		// `value()` throws while the resource is loading or errored; read it only
		// once a value is present so an unreachable backend degrades gracefully.
		return this.me.hasValue() ? (this.me.value()?.authenticated ?? false) : false;
	});

	/** The authenticated user identity, if any (normalised; requires a subject). */
	public readonly user: Signal<SessionUser | undefined> = computed(() =>
	{
		if (!this.me.hasValue())
		{
			return undefined;
		}
		// The gateway carries the IAM role claims through unchanged so capability
		// derivation can remain transport-neutral and fail closed.
		const u = this.me.value()?.user;
		if (!u || !u.sub)
		{
			return undefined;
		}
		return {
			sub: u.sub,
			email: u.email,
			name: u.name,
			groups: u.groups,
			isPlatformOperator: u.isPlatformOperator,
			isOrgAdmin: u.isOrgAdmin,
			clusterTenant: u.clusterTenant
		};
	});

	/** Display name for the current user, falling back to the email. */
	public readonly displayName: Signal<string | undefined> = computed(() =>
	{
		const u = this.user();
		return u?.name ?? u?.email;
	});

	/**
	 * Capability flags that drive fail-closed UI gating from explicit role claims.
	 * The API remains the enforcement point; these flags only hide or disable controls.
	 */
	public readonly capabilities: Signal<Capabilities> = computed(() =>
	{
		const authenticated = this.authenticated();
		const u = this.user();
		// Fail-closed: an operator/admin power requires an EXPLICIT claim from the
		// session authority. A live authenticated session carries these fields;
		// an absent or malformed claim (mis-issued token or incomplete mock)
		// therefore grants no capabilities rather than silently
		// elevating an ordinary session to operator. The API remains the enforcement
		// point — these flags only gate UI.
		const isPlatformOperator = u?.isPlatformOperator ?? false;
		const isOrgAdmin = u?.isOrgAdmin ?? false;
		return _DeriveCapabilities(authenticated, isPlatformOperator, isOrgAdmin, this._surface);
	});

	/** Re-fetch identity state, for example after login. */
	public reload(): void
	{
		this.me.reload();
	}

	/**
	 * Log out the current session and redirect to the landing page.
	 *
	 * @returns A promise that resolves when the logout is complete.
	 */
	public async logout(): Promise<void>
	{
		await this._gateway.logout(this._surface);
		if (typeof window !== "undefined")
		{
			window.location.assign("/");
		}
	}
}
