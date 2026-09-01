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
		// `/auth/me` carries verified identity plus the central product-capability projection.
		const u = this.me.value()?.user;
		if (!u || !u.sub)
		{
			return undefined;
		}
		const productCapabilities = "productCapabilities" in u ? u.productCapabilities : undefined;
		const administerOrganization = typeof productCapabilities === "object" && productCapabilities !== null && "administerOrganization" in productCapabilities
			? productCapabilities.administerOrganization === true
			: undefined;
		return {
			sub: u.sub,
			email: u.email,
			name: u.name,
			groups: u.groups,
			isPlatformOperator: u.isPlatformOperator,
			productCapabilities: { administerOrganization },
			// `clusterTenant` is a silo (Control Plane) claim only — the fleet
			// `/auth/me` carries none (the platform plane is cluster-wide), so the
			// union narrows it away; read it defensively off the opencrane-ui arm.
			clusterTenant: "clusterTenant" in u ? (u.clusterTenant as string | null) : undefined
		};
	});

	/** Display name for the current user, falling back to the email. */
	public readonly displayName: Signal<string | undefined> = computed(() =>
	{
		const u = this.user();
		return u?.name ?? u?.email;
	});

	/**
	 * Capability flags driving UI gating. Organisation management comes from the central
	 * authorization projection; the API remains the enforcement point for every operation.
	 */
	public readonly capabilities: Signal<Capabilities> = computed(() =>
	{
		const authenticated = this.authenticated();
		const u = this.user();
		// Fail closed when either the platform-control claim or product capability is absent.
		const isPlatformOperator = u?.isPlatformOperator ?? false;
		const administerOrganization = u?.productCapabilities?.administerOrganization ?? false;
		return _DeriveCapabilities(authenticated, isPlatformOperator, administerOrganization, this._surface);
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
