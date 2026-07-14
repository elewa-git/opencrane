import { Injectable, inject } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { MockClockService } from "./mock-clock.service.js";
import { MockScenarioService } from "./mock-scenario.service.js";
import { MockSessionService } from "./mock-session.service.js";
import { MockSettingsService } from "./mock-settings.service.js";

/** Resets every mock owner as one isolated deterministic test boundary. */
@Injectable()
export class MockResetService
{
	/** Content and access selector owner. */
	private readonly _scenarios = inject(MockScenarioService);

	/** Deterministic scheduler and identifier owner. */
	private readonly _clock = inject(MockClockService);

	/** Session store owner. */
	private readonly _sessions = inject(MockSessionService);

	/** Settings aggregate store owner. */
	private readonly _settings = inject(MockSettingsService);

	/** Restores selectors, scheduler state, and every owned data store. */
	public reset(): void
	{
		// 1. Selectors — restore the default provider modes before stores derive fixtures.
		this._scenarios.reset();

		// 2. Scheduler — discard pending work and reseed task and entity identifiers.
		this._clock.reset();

		// 3. Stores — rebuild all aggregates from fresh default fixture objects.
		this._sessions.reset();
		this._settings.reset();
	}

	/** Selects one scenario and rebuilds every scenario-owned store in isolation. */
	public selectScenario(scenario: UiMockScenario): void
	{
		// 1. Scheduler — isolate the scenario from pending work and prior identifiers.
		this._clock.reset();

		// 2. Selector — publish the requested presentation state before stores rebuild.
		this._scenarios.selectScenario(scenario);

		// 3. Stores — apply the same scenario to every aggregate owner atomically.
		this._sessions.reset(scenario);
		this._settings.reset(scenario);
	}
}
