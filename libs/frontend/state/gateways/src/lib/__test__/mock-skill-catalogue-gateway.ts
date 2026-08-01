import { Injectable } from "@angular/core";

import type { GovernedSkill, SkillCatalogueGateway } from "@opencrane/state/skills/adapter";

/** In-memory governed-skill gateway for UI-state tests. */
@Injectable()
export class MockSkillCatalogueGateway implements SkillCatalogueGateway
{
	/** Configurable host-silo governed-skill fixture. */
	public skills: readonly GovernedSkill[] = [];

	/** @inheritdoc */
	public async list(): Promise<readonly GovernedSkill[]>
	{
		return this.skills;
	}
}
