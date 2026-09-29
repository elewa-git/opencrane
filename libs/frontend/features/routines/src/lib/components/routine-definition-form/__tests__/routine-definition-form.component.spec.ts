// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type InputSignal, ɵInputSignalNode as InputSignalNode, ɵresolveComponentResources as resolveComponentResources, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { By } from "@angular/platform-browser";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Select } from "primeng/select";

import { RoutineScheduleModes, type RoutineDefinitionDraft } from "../../../routine-presentation.types";
import { RoutineDefinitionFormComponent } from "../routine-definition-form.component";

/** Stable daily draft used to render the timezone select without unrelated form state. */
const _DRAFT: RoutineDefinitionDraft = { scheduleMode: RoutineScheduleModes.Daily, localTime: "09:00", weekday: 1, expression: "0 9 * * *", timezone: "Europe/Brussels", instruction: "Summarize open decisions and next actions.", selectedManagedServiceId: "service-1", audienceParticipantRefs: ["self"] };

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	const template = readFileSync(join(process.cwd(), "src/lib/components/routine-definition-form/routine-definition-form.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("routine-definition-form.component.html"))
			return template;
		return "";
	});
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

/** Sets a signal input because source-mode JIT cannot discover input() metadata. */
function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

/** Mounts the production form with the supplied readonly timezone input. */
function _Mount(timezoneChoices: readonly string[]): ComponentFixture<RoutineDefinitionFormComponent>
{
	TestBed.configureTestingModule({ imports: [RoutineDefinitionFormComponent] });
	const fixture = TestBed.createComponent(RoutineDefinitionFormComponent);
	_SetInput(fixture.componentInstance.draft, _DRAFT);
	_SetInput(fixture.componentInstance.timezoneChoices, timezoneChoices);
	fixture.detectChanges();
	return fixture;
}

describe("RoutineDefinitionFormComponent", function _DefinitionForm()
{
	it("projects frozen timezone inputs into refreshed PrimeNG options without mutation", function _TimezoneOptions()
	{
		const initial = Object.freeze(["Europe/Brussels", "Africa/Nairobi"]);
		const fixture = _Mount(initial);
		const select = fixture.debugElement.query(By.directive(Select)).injector.get(Select);
		const firstOptions = select.options;

		expect(Object.isFrozen(initial)).toBe(true);
		expect(initial).toEqual(["Europe/Brussels", "Africa/Nairobi"]);
		expect(firstOptions).toEqual(initial);
		expect(firstOptions).not.toBe(initial);

		const replacement = Object.freeze(["UTC", "Africa/Nairobi", "America/New_York"]);
		_SetInput(fixture.componentInstance.timezoneChoices, replacement);
		fixture.detectChanges();

		const refreshedSelect = fixture.debugElement.query(By.directive(Select)).injector.get(Select);
		const refreshedOptions = refreshedSelect.options;
		expect(refreshedOptions).toEqual(replacement);
		expect(refreshedOptions).not.toBe(replacement);
		expect(refreshedOptions).not.toBe(firstOptions);
		expect(initial).toEqual(["Europe/Brussels", "Africa/Nairobi"]);
	});
});
