import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";

import type { PersonalAsset, PersonalAssetsGateway } from "./personal-assets-gateway.types";

/** Live gateway for the signed-in user's browser-safe personal asset catalogue. */
@Injectable()
export class OpenCranePersonalAssetsGateway implements PersonalAssetsGateway
{
	/** Shared cookie-session Control Plane API client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async list(): Promise<readonly PersonalAsset[]>
	{
		const { data, error } = await this._api.client.GET("/me/assets");
		if (error || !data) throw new Error("failed to list personal assets");
		return data.assets;
	}
}
