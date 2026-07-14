import { InputSignal, ɵSIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { _ResolveTestResources } from "../../../../vitest.setup.js";
import { UiIdentity, UiRole } from "../../core/models/ui-data.types.js";
import { UiSessionSummary } from "../../core/models/session.types.js";
import { AppSidebarComponent } from "./app-sidebar/app-sidebar.component.js";
import { ProgressMeterComponent } from "./progress-meter/progress-meter.component.js";
import { SettingsRowComponent } from "./settings-row/settings-row.component.js";
import { ToggleFieldComponent } from "./toggle-field/toggle-field.component.js";

/** Deterministic identity rendered by shared-component tests. */
const IDENTITY: UiIdentity =
{
	id: "identity-test",
	name: "Amara Okafor",
	handle: "@amara",
	email: "amara@example.test",
	department: "Product",
	initials: "AO",
	role: UiRole.Administrator
};

/** Deterministic owned and shared Session rows. */
const SESSIONS: readonly UiSessionSummary[] =
[
	{ id: "owned", title: "A deliberately long owned session title used to verify wrapping safety", scope: "Product", owned: true, unread: 2, active: true },
	{ id: "shared", title: "Shared launch review", scope: "Operations", owned: false, active: false }
];

/** Assigns a signal input directly because the lightweight Vitest transform does not emit Angular input metadata. */
function _SetInput<T>(signal: InputSignal<T>, value: T): void
{
	const node = signal[ɵSIGNAL];
	node.applyValueToInputSignal(node, value);
}

describe("G1 shared UI components", function _SharedComponentSuite(): void
{
	beforeAll(_ResolveTestResources);

	it("groups sidebar variants and emits navigation requests", function _RenderSidebar(): void
	{
		const component = TestBed.runInInjectionContext(function _CreateSidebar(): AppSidebarComponent
		{
			return new AppSidebarComponent();
		});
		const selected = vi.fn();
		_SetInput(component.sessions, SESSIONS);
		_SetInput(component.identity, IDENTITY);
		_SetInput(component.selectedSessionId, "owned");
		component.sessionSelected.subscribe(selected);

		expect(component.ownedSessions()).toHaveLength(1);
		expect(component.sharedSessions()[0]?.title).toBe("Shared launch review");
		component.sessionSelected.emit("shared");
		expect(selected).toHaveBeenCalledWith("shared");
	});

	it("clamps progress and exposes warning and status variants", function _RenderProgress(): void
	{
		const fixture = TestBed.createComponent(ProgressMeterComponent);
		_SetInput(fixture.componentInstance.used, 120);
		_SetInput(fixture.componentInstance.limit, 100);
		_SetInput(fixture.componentInstance.label, "Monthly budget");
		_SetInput(fixture.componentInstance.status, "Limit reached");
		fixture.detectChanges();

		expect(fixture.componentInstance.percentage()).toBe(100);
		expect(fixture.nativeElement.querySelector(".meter")?.classList.contains("meter--warning")).toBe(true);
		expect(fixture.nativeElement.textContent).toContain("Limit reached");
	});

	it("associates Settings help and error copy with its field group", function _AssociateSettingsRow(): void
	{
		const fixture = TestBed.createComponent(SettingsRowComponent);
		_SetInput(fixture.componentInstance.fieldId, "display-name");
		_SetInput(fixture.componentInstance.label, "Display name");
		_SetInput(fixture.componentInstance.description, "Shown to collaborators");
		_SetInput(fixture.componentInstance.message, "Display name is required");
		_SetInput(fixture.componentInstance.invalid, true);
		fixture.detectChanges();

		expect(fixture.nativeElement.getAttribute("aria-labelledby")).toBe("display-name-label");
		expect(fixture.nativeElement.getAttribute("aria-describedby")).toBe("display-name-description display-name-message");
		expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain("required");
	});

	it("disables pending toggles and retains a visible associated label", function _RenderToggle(): void
	{
		const fixture = TestBed.createComponent(ToggleFieldComponent);
		_SetInput(fixture.componentInstance.fieldId, "citation-mode");
		_SetInput(fixture.componentInstance.label, "Citation mode");
		_SetInput(fixture.componentInstance.pending, true);
		fixture.detectChanges();

		const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
		expect(input.disabled).toBe(true);
		expect(fixture.nativeElement.querySelector("label")?.getAttribute("for")).toBe("citation-mode");
	});
});
