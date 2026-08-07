import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";

import type { GovernedSkill, SkillCatalogueGateway } from "./skill-catalogue-gateway.types";

/** Live read-only gateway for the host-silo governed skill catalogue. */
@Injectable()
export class OpenCraneSkillCatalogueGateway implements SkillCatalogueGateway
{
	/** Shared cookie-session Control Plane client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async list(): Promise<readonly GovernedSkill[]>
	{
		const { data, error } = await this._api.client.GET("/skills");
		if (error || !data) throw new Error("failed to list governed skills");
		return data.skills;
	}
}
