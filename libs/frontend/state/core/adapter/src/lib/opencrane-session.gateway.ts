import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService, FleetManagerApiService } from "@opencrane/core";
import { type PlatformSurface, type SessionGateway, type SessionSnapshot, type SessionUser } from "@opencrane/state/core";

/**
 * Implements browser sessions against the API that owns each application surface: the Control
 * Plane for organization sessions and Fleet Manager for platform sessions. This keeps generated
 * clients out of {@link SessionStore} and preserves load errors for the store's resource state.
 *
 * Called by: {@link provideOpenCraneUiLiveGateways}, which binds this class in the live profile.
 * @implements SessionGateway
 */
@Injectable()
export class OpenCraneSessionGateway implements SessionGateway
{
	/** Generated Control Plane client for organization sessions. */
	private readonly _controlPlane = inject(ControlPlaneApiService);

	/** Generated Fleet Manager client for platform sessions. */
	private readonly _fleetManager = inject(FleetManagerApiService);

	/** @inheritdoc */
	public async load(surface: PlatformSurface): Promise<SessionSnapshot>
	{
		if (surface === "platform")
		{
			const { data, error } = await this._fleetManager.client.GET("/auth/me", {});
			if (error)
			{
				throw error;
			}
			return _MapSessionSnapshot(data);
		}

		const { data, error } = await this._controlPlane.client.GET("/auth/me", {});
		if (error)
		{
			throw error;
		}
		return _MapSessionSnapshot(data);
	}

	/** @inheritdoc */
	public async logout(surface: PlatformSurface): Promise<void>
	{
		if (surface === "platform")
		{
			await this._fleetManager.client.POST("/auth/logout");
			return;
		}

		await this._controlPlane.client.POST("/auth/logout");
	}
}

/** Drops generated response fields such as `mode` and `issuer` before state reaches the store. */
function _MapSessionSnapshot(value: SessionSnapshot): SessionSnapshot
{
	if (!value.user)
	{
		return { authenticated: value.authenticated, user: value.user };
	}

	return { authenticated: value.authenticated, user: _MapSessionUser(value.user) };
}

/** Copies the identity claims used by frontend capability and display state. */
function _MapSessionUser(value: SessionUser): SessionUser
{
	return {
		sub: value.sub,
		email: value.email,
		name: value.name,
		groups: value.groups,
		isPlatformOperator: value.isPlatformOperator,
		isOrgAdmin: value.isOrgAdmin,
		clusterTenant: value.clusterTenant
	};
}
