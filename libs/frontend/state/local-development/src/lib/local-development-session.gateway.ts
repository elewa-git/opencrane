import { Injectable, inject } from "@angular/core";

import type { PlatformSurface, SessionGateway, SessionSnapshot } from "@opencrane/state/core";

import { LocalDevelopmentState } from "./local-development-state";

/**
 * Supplies an authenticated organization user so guarded Tier 1 routes can be exercised without an
 * identity provider. Both role booleans are false, which proves ordinary-user onboarding and chat
 * without granting the local profile administrator controls.
 */
@Injectable()
export class LocalDevelopmentSessionGateway implements SessionGateway
{
	/** Share the same lifecycle owner as every other local gateway. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Return the authenticated local user after applying any selected delay. */
	public async load(_surface: PlatformSurface): Promise<SessionSnapshot>
	{
		await this._state.delay();
		return { authenticated: true, user: { sub: "user-local-1", email: "developer@opencrane.local", name: "Local Developer", groups: [], isPlatformOperator: false, isOrgAdmin: false, clusterTenant: "local-development" } };
	}

	/** Finish immediately because Tier 1 owns no identity-provider session. */
	public async logout(_surface: PlatformSurface): Promise<void>
	{
		return;
	}
}
