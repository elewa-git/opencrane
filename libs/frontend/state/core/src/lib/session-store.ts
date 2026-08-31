import { Injectable, Signal, computed, inject, resource } from "@angular/core";

import { ControlPlaneApiService, FleetManagerApiService } from "@opencrane/core";
import { Capabilities, SessionUser } from "./session-store.types";
import { _DeriveCapabilities } from "./session-store.util";
import { PLATFORM_SURFACE } from "./platform-surface";

/**
 * App-wide identity and capability state, sourced from **this surface's** API.
 *
 * Platform and org are strictly-separated domains with their own OIDC sessions
 * (see {@link PLATFORM_SURFACE}), so auth is read from the surface-appropriate
 * client: the platform app authenticates against the platform API, and the
 * org app against the Control Plane API. `me` mirrors `GET /auth/me`. All values are signals; capabilities are
 * `computed` so RBAC checks in templates are memoised reads, not method calls.
 */
@Injectable({ providedIn: "root" })
export class SessionStore
{
	/** Typed Control Plane client for the org-admin surface. */
	private readonly _cp = inject(ControlPlaneApiService);

	/** Typed Fleet Manager client (platform-operator surface auth). */
	private readonly _fleet = inject(FleetManagerApiService);

	/** Which strictly-separated surface this app serves — platform vs org (see {@link PLATFORM_SURFACE}). */
	private readonly _surface = inject(PLATFORM_SURFACE);

	/** Current auth status (`mode`, `authenticated`, `user`), read from this surface's `/auth/me`. One-shot read. */
	public readonly me = resource({
		loader: async () =>
		{
			// Each surface owns its own OIDC session — read from its own client.
			if (this._surface === "platform")
			{
				const { data, error } = await this._fleet.client.GET("/auth/me", {});
				if (error)
				{
					throw error;
				}
				return data;
			}
			const { data, error } = await this._cp.client.GET("/auth/me", {});
			if (error)
			{
				throw error;
			}
			return data;
		}
	});

	/** Whether a opencrane-ui session is established. */
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
		// End the session on this surface's own API (platform vs org).
		if (this._surface === "platform")
		{
			await this._fleet.client.POST("/auth/logout");
		}
		else
		{
			await this._cp.client.POST("/auth/logout");
		}
		if (typeof window !== "undefined")
		{
			window.location.assign("/");
		}
	}
}
