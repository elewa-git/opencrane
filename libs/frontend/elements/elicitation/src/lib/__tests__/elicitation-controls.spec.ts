// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { provideZonelessChangeDetection, type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL, ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ElicitationApprovalScopes } from "@opencrane/contracts";

import { ElicitationApprovalComponent, _ApprovalAvailable } from "../elicitation-approval.component";
import type { ElicitationApprovalPresentation } from "../elicitation-control.types";

/** Supplies approved display text without assigning any execution or decision authority. */
const _BODY: ElicitationApprovalPresentation = {
	prompt: "Create this calendar event?",
	action: "Create event",
	target: "Planning calendar",
	dataUse: "Meeting details",
	proposedArguments: { title: "Quarterly planning" },
	executionConnection: { owner: "Finance assistant (company assistant)", credentialUse: "This connection's principal-bound credential" },
	consequence: "Invited colleagues receive an invitation."
};

/** Sets a signal because source-mode JIT cannot discover input() metadata. */
function _setInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

/** Renders the production template with the same zoneless change detection as the application. */
function _renderApproval(body: ElicitationApprovalPresentation, disabled = false, approvalDisabled = false): ComponentFixture<ElicitationApprovalComponent>
{
	TestBed.configureTestingModule({ imports: [ElicitationApprovalComponent], providers: [provideZonelessChangeDetection()] });
	const fixture = TestBed.createComponent(ElicitationApprovalComponent);
	_setInput(fixture.componentInstance.body, body);
	_setInput(fixture.componentInstance.disabled, disabled);
	_setInput(fixture.componentInstance.approvalDisabled, approvalDisabled);
	fixture.detectChanges();
	return fixture;
}

/** Reads the definition paired with a visible disclosure term. */
function _definition(root: HTMLElement, term: string): Element | null
{
	const label = Array.from(root.querySelectorAll("dl dt")).find(candidate => candidate.textContent === term);
	return label?.nextElementSibling ?? null;
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("elicitation-control.component.scss"))
			return "";
		if (url.endsWith("elicitation-approval.component.html"))
			return readFileSync(join(process.cwd(), "src/lib/elicitation-approval.component.html"), "utf8");
		throw new Error(`Unexpected approval component resource: ${url}`);
	});
});
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ElicitationApprovalComponent", function _ApprovalSuite()
{
	it("emits an approval draft without submitting or advancing authority", function _DraftOnly()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.deny();
		expect(emitted).toEqual({ approved: false, scope: ElicitationApprovalScopes.Once });
	});

	it("keeps denial available when hidden arguments make approval unavailable", function _HiddenArguments()
	{
		const base = { prompt: "Continue?", action: "Send data", target: "Calendar", dataUse: "Meeting details", consequence: "A meeting may be created." };
		expect(_ApprovalAvailable({ ...base, proposedArguments: null }, false)).toBe(false);
		expect(_ApprovalAvailable(base, true)).toBe(false);
		expect(_ApprovalAvailable(base, false)).toBe(true);
	});

	it("renders both connection definitions as escaped text without changing the decision controls", function _ConnectionDisclosure()
	{
		const owner = "<img src=x onerror=alert(1)> Amina & Finance";
		const credentialUse = "<strong>Organisation-shared credential</strong>";
		const fixture = _renderApproval({ ..._BODY, executionConnection: { owner, credentialUse } });
		const root = fixture.nativeElement as HTMLElement;
		expect(_definition(root, "Connection owner")?.tagName).toBe("DD");
		expect(_definition(root, "Connection owner")?.textContent).toBe(owner);
		expect(_definition(root, "Credential use")?.tagName).toBe("DD");
		expect(_definition(root, "Credential use")?.textContent).toBe(credentialUse);
		expect(root.querySelector("img, strong, script")).toBeNull();
		expect(root.querySelector("legend")?.textContent).toBe("Your decision");
		expect(root.querySelectorAll("input[type='radio']")).toHaveLength(2);
		expect(root.querySelector("button, form")).toBeNull();
	});

	it("omits both connection rows when the feature supplies no disclosure", function _OmittedConnection()
	{
		const fixture = _renderApproval({ ..._BODY, executionConnection: undefined });
		const root = fixture.nativeElement as HTMLElement;
		expect(_definition(root, "Connection owner")).toBeNull();
		expect(_definition(root, "Credential use")).toBeNull();
		expect(_definition(root, "Action")?.textContent).toBe(_BODY.action);
	});

	it("retains long localised owner text and updates the displayed connection", function _ChangedConnection()
	{
		const owner = "Équipe financière — Nairobi / 你好 ".repeat(5);
		const fixture = _renderApproval({ ..._BODY, executionConnection: { owner, credentialUse: "No credentials required" } });
		const root = fixture.nativeElement as HTMLElement;
		expect(_definition(root, "Connection owner")?.textContent).toBe(owner);
		_setInput(fixture.componentInstance.body, _BODY);
		fixture.detectChanges();
		expect(_definition(root, "Connection owner")?.textContent).toBe(_BODY.executionConnection?.owner);
		expect(_definition(root, "Credential use")?.textContent).toBe(_BODY.executionConnection?.credentialUse);
	});

	it("emits choices without adopting a draft or submitting the action", function _ControlledSelection()
	{
		const fixture = _renderApproval(_BODY);
		const selected = vi.fn();
		fixture.componentInstance.valueChange.subscribe(selected);
		const [approve, deny] = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>("input[type='radio']");
		approve.click();
		deny.click();
		expect(selected.mock.calls).toEqual([[{ approved: true, scope: ElicitationApprovalScopes.Once }], [{ approved: false, scope: ElicitationApprovalScopes.Once }]]);
		expect(fixture.componentInstance.value()).toBeNull();
	});

	it("keeps the owner visible and denial available when arguments are hidden", function _RenderedHiddenArguments()
	{
		const fixture = _renderApproval({ ..._BODY, proposedArguments: null });
		const root = fixture.nativeElement as HTMLElement;
		const selected = vi.fn();
		fixture.componentInstance.valueChange.subscribe(selected);
		const [approve, deny] = root.querySelectorAll<HTMLInputElement>("input[type='radio']");
		expect(approve.matches(":disabled")).toBe(true);
		expect(deny.matches(":disabled")).toBe(false);
		approve.click();
		deny.click();
		expect(selected.mock.calls).toEqual([[{ approved: false, scope: ElicitationApprovalScopes.Once }]]);
		expect(_definition(root, "Connection owner")?.textContent).toBe(_BODY.executionConnection?.owner);
		expect(root.querySelector("[role='note']")?.textContent).toContain("approval is unavailable");
	});

	it("keeps both decisions disabled without hiding the connection", function _RenderedDisabled()
	{
		const fixture = _renderApproval(_BODY, true);
		const root = fixture.nativeElement as HTMLElement;
		const selected = vi.fn();
		fixture.componentInstance.valueChange.subscribe(selected);
		for (const control of root.querySelectorAll<HTMLInputElement>("input[type='radio']"))
		{
			expect(control.matches(":disabled")).toBe(true);
			control.click();
		}
		fixture.componentInstance.approve(ElicitationApprovalScopes.Once);
		fixture.componentInstance.deny();
		expect(selected).not.toHaveBeenCalled();
		expect(_definition(root, "Connection owner")?.textContent).toBe(_BODY.executionConnection?.owner);
		expect(_definition(root, "Credential use")?.textContent).toBe(_BODY.executionConnection?.credentialUse);
	});

	it("offers standing approval only with the server's complete explanation", function _StandingApproval()
	{
		const standing = _renderApproval({ ..._BODY, offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Always], standingScope: { explanation: "Future actions must match this assistant, connection, tool and the exact reviewed details. You can revoke this in Settings." } });
		const controls = (standing.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>("input[type='radio']");
		expect(Array.from(controls).map(control => control.parentElement?.textContent?.trim())).toEqual(["Approve once", "Approve always", "Deny"]);
		expect((standing.nativeElement as HTMLElement).textContent).toContain("You can revoke this in Settings");

		_setInput(standing.componentInstance.body, { ..._BODY, offeredScopes: [ElicitationApprovalScopes.Once, ElicitationApprovalScopes.Always] });
		standing.detectChanges();
		expect(Array.from((standing.nativeElement as HTMLElement).querySelectorAll("label")).map(label => label.textContent?.trim())).toEqual(["Approve once", "Deny"]);
	});

	it("retains the feature's independent approval-disabled guard", function _FeatureApprovalDisabled()
	{
		const fixture = _renderApproval(_BODY, false, true);
		const [approve, deny] = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>("input[type='radio']");
		expect(approve.matches(":disabled")).toBe(true);
		expect(deny.matches(":disabled")).toBe(false);
	});
});
