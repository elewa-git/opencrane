import { Injectable, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiMember, UiOrganizationUnit } from "../models/settings.types.js";
import { _DefaultMembers, _DefaultOrganizationUnits } from "./fixtures/settings.fixtures.js";

/** Owns deterministic member, department, team, and project state. */
@Injectable()
export class MockOrganizationService
{
	/** Mutable member rows. */
	private readonly _members = signal<readonly UiMember[]>(_DefaultMembers());

	/** Mutable organization-unit rows. */
	private readonly _units = signal<readonly UiOrganizationUnit[]>(_DefaultOrganizationUnits());

	/** Read-only member rows. */
	public readonly members = this._members.asReadonly();

	/** Read-only organization-unit rows. */
	public readonly units = this._units.asReadonly();

	/** Replaces one organization unit after a mock form submission. */
	public saveUnit(value: UiOrganizationUnit): void
	{
		this._units.update(function _saveUnit(units: readonly UiOrganizationUnit[]): readonly UiOrganizationUnit[]
		{
			return units.some(function _matches(unit: UiOrganizationUnit): boolean { return unit.id === value.id; })
				? units.map(function _replace(unit: UiOrganizationUnit): UiOrganizationUnit { return unit.id === value.id ? { ...value } : unit; })
				: [...units, { ...value }];
		});
	}

	/** Restores deterministic organization fixtures. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		const empty = scenario === UiMockScenario.Empty;
		this._members.set(empty ? [] : _DefaultMembers());
		this._units.set(empty ? [] : _DefaultOrganizationUnits());
	}
}
