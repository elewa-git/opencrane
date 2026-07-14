import { Injectable, computed, signal } from "@angular/core";

import { UiMockAccessMode, UiMockScenario } from "../models/mock-scenario.types.js";
import { UiDataPresentationState } from "../models/ui-data.types.js";

/** Owns deterministic content and access modes for the explicit mock build. */
@Injectable()
export class MockScenarioService
{
	/** Mutable content scenario selected by tests or manual query parameters. */
	private readonly _scenario = signal<UiMockScenario>(_InitialScenario());

	/** Mutable access mode selected independently from content state. */
	private readonly _accessMode = signal<UiMockAccessMode>(_InitialAccessMode());

	/** Read-only current content scenario. */
	public readonly scenario = this._scenario.asReadonly();

	/** Read-only current route-access mode. */
	public readonly accessMode = this._accessMode.asReadonly();

	/** Provider-neutral presentation flags derived from the selected deterministic scenario. */
	public readonly presentation = computed(function _Presentation(this: MockScenarioService): UiDataPresentationState
	{
		const scenario = this.scenario();
		return {
			loading: scenario === UiMockScenario.Loading,
			error: scenario === UiMockScenario.Error ? "The mock provider could not complete this request. Try again." : null,
			permissionRestricted: scenario === UiMockScenario.Permission,
			limitReached: scenario === UiMockScenario.Limits,
			offline: scenario === UiMockScenario.Offline,
			longContent: scenario === UiMockScenario.LongContent
		};
	}.bind(this));

	/** Selects a deterministic content scenario. */
	public selectScenario(scenario: UiMockScenario): void
	{
		this._scenario.set(scenario);
	}

	/** Selects a deterministic identity and route-access mode. */
	public selectAccessMode(accessMode: UiMockAccessMode): void
	{
		this._accessMode.set(accessMode);
	}

	/** Restores the mock provider to its default deterministic state. */
	public reset(): void
	{
		this._scenario.set(UiMockScenario.Default);
		this._accessMode.set(UiMockAccessMode.Administrator);
	}
}

/** Reads the initial content scenario from the current mock-build URL. */
function _InitialScenario(): UiMockScenario
{
	const value = _QueryValue("mockScenario");
	return Object.values(UiMockScenario).includes(value as UiMockScenario) ? value as UiMockScenario : UiMockScenario.Default;
}

/** Reads the initial access mode from the current mock-build URL. */
function _InitialAccessMode(): UiMockAccessMode
{
	const value = _QueryValue("mockAccess");
	return Object.values(UiMockAccessMode).includes(value as UiMockAccessMode) ? value as UiMockAccessMode : UiMockAccessMode.Administrator;
}

/** Reads one query-string value without assuming a browser exists in unit tests. */
function _QueryValue(name: string): string | null
{
	if (typeof globalThis.location === "undefined")
	{
		return null;
	}
	return new URLSearchParams(globalThis.location.search).get(name);
}
