import { Injectable, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiBudgetSettings } from "../models/settings.types.js";
import { _DefaultBudget } from "./fixtures/settings.fixtures.js";

/** Owns deterministic organization and personal budget presentation state. */
@Injectable()
export class MockBudgetService
{
	/** Mutable budget summary. */
	private readonly _budget = signal<UiBudgetSettings>(_DefaultBudget());

	/** Read-only budget summary. */
	public readonly budget = this._budget.asReadonly();

	/** Replaces the budget summary after a mock Save action. */
	public save(value: UiBudgetSettings): void
	{
		this._budget.set({ ...value });
	}

	/** Restores the deterministic budget fixture. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		const budget = _DefaultBudget();
		this._budget.set(scenario === UiMockScenario.Limits ? { ...budget, spent: budget.limit } : budget);
	}
}
