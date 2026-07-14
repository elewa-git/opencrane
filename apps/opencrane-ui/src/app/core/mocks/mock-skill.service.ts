import { Injectable, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiSkill } from "../models/settings.types.js";
import { _DefaultSkills } from "./fixtures/settings.fixtures.js";

/** Owns deterministic installed and marketplace skill state. */
@Injectable()
export class MockSkillService
{
	/** Mutable skill rows. */
	private readonly _skills = signal<readonly UiSkill[]>(_DefaultSkills());

	/** Read-only skill rows. */
	public readonly skills = this._skills.asReadonly();

	/** Toggles installed or enabled state for one skill. */
	public update(skillId: string, changes: Partial<Pick<UiSkill, "installed" | "enabled">>): void
	{
		this._skills.update(function _update(skills: readonly UiSkill[]): readonly UiSkill[]
		{
			return skills.map(function _updateSkill(skill: UiSkill): UiSkill
			{
				return skill.id === skillId ? { ...skill, ...changes } : skill;
			});
		});
	}

	/** Restores deterministic skill fixtures. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		this._skills.set(scenario === UiMockScenario.Empty ? [] : _DefaultSkills());
	}
}
