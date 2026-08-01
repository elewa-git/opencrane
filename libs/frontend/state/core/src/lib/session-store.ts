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
		// `/auth/me` carries the IAM role claims (`groups`, `isPlatformOperator`,
		// `isOrgAdmin`, `clusterTenant`) declared by the pinned contract; read them
		// straight off the typed response and pass them through verbatim for
		// `capabilities` to resolve.
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
	 * Capability flags driving UI gating. Interim model: any authenticated
	 * session is treated as an operator until the opencrane-ui emits roles
	 * (see `docs/architecture.md` §5.2). The API remains the enforcement point —
	 * these flags only hide/disable controls.
	 */
	public readonly capabilities: Signal<Capabilities> = computed(() =>
	{
		const authenticated = this.authenticated();
		const u = this.user();
		// Fail-closed: an operator/admin power requires an EXPLICIT claim from the
		// control plane. `/auth/me` marks these role fields required, so a live
		// authenticated session always carries them; a missing claim (mis-issued
		// token, older backend) therefore grants NOTHING rather than silently
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
