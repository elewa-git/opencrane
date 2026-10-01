// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type InputSignal, ɵInputSignalNode as InputSignalNode, ɵresolveComponentResources as resolveComponentResources, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PersonalMcpConnectionControlComponent } from "../personal-mcp-connection-control.component";
import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds, type PersonalMcpConnectionControlView } from "../personal-mcp-connection-control.types";

beforeAll(async function _Initialize()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	const directory = join(process.cwd(), "src/lib/my-tools/personal-mcp-connection-control");
	const template = readFileSync(join(directory, "personal-mcp-connection-control.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		return url.endsWith(".html") ? template : "";
	});
});
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

/** Creates a complete controlled view while each test selects only the state it exercises. */
function _View(overrides: Partial<PersonalMcpConnectionControlView> = {}): PersonalMcpConnectionControlView
{
	return { controlId: "weather-connection", serverName: "Weather service", state: PersonalMcpConnectionControlStates.Connect, credentialInput: PersonalMcpCredentialInputKinds.Bearer, draft: "", canReplace: false, canRevoke: false, failureMessage: null, ...overrides };
}

/** Mounts the standalone control with all required parent inputs. */
function _Mount(view: PersonalMcpConnectionControlView, error: string | null = null)
{
	TestBed.configureTestingModule({ imports: [PersonalMcpConnectionControlComponent] });
	const fixture = TestBed.createComponent(PersonalMcpConnectionControlComponent);
	_SetInput(fixture.componentInstance.view, view);
	_SetInput(fixture.componentInstance.busy, false);
	_SetInput(fixture.componentInstance.error, error);
	fixture.detectChanges();
	return fixture;
}

/** Sets a signal input directly because source-mode JIT metadata cannot discover `input()` fields. */
function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

describe("personal MCP connection control", function _Control()
{
	it("keeps bearer input write-only and emits its exact untrimmed value", function _BearerInput()
	{
		const fixture = _Mount(_View());
		const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
		const changed = vi.fn();
		fixture.componentInstance.draftChanged.subscribe(changed);
		expect(input.type).toBe("password");
		expect(input.autocomplete).toBe("off");
		expect(input.getAttribute("aria-label") ?? input.labels?.[0]?.textContent).toContain("Weather service");
		expect(fixture.nativeElement.textContent).toContain("cannot view it later");
		input.value = "  retained bearer  ";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(changed).toHaveBeenCalledWith("  retained bearer  ");
	});

	it("uses one form path for Enter and click submission", function _SubmitParity()
	{
		const fixture = _Mount(_View({ draft: "bearer" }));
		const submitted = vi.fn();
		fixture.componentInstance.submitRequested.subscribe(submitted);
		fixture.nativeElement.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		(fixture.nativeElement.querySelector("button[type=submit]") as HTMLButtonElement).click();
		expect(submitted).toHaveBeenCalledTimes(2);
	});

	it("refuses empty and over-bound bearer drafts before emitting a command", function _Bounds()
	{
		const fixture = _Mount(_View());
		const submitted = vi.fn();
		fixture.componentInstance.submitRequested.subscribe(submitted);
		const button = fixture.nativeElement.querySelector("button[type=submit]") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		_SetInput(fixture.componentInstance.view, _View({ draft: "x".repeat(8193) }));
		fixture.detectChanges();
		expect(button.disabled).toBe(true);
		button.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(submitted).not.toHaveBeenCalled();
	});

	it("connects credentialless servers without rendering a secret field", function _Credentialless()
	{
		const fixture = _Mount(_View({ credentialInput: PersonalMcpCredentialInputKinds.None }));
		expect(fixture.nativeElement.querySelector("input")).toBeNull();
		expect((fixture.nativeElement.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
	});

	it("locks ambiguous bearer edits while keeping exact Retry available", function _Ambiguous()
	{
		const fixture = _Mount(_View({ state: PersonalMcpConnectionControlStates.Ambiguous, draft: "retained" }));
		const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
		const button = fixture.nativeElement.querySelector("button[type=submit]") as HTMLButtonElement;
		expect(input.disabled).toBe(true);
		expect(button.textContent?.trim()).toBe("Retry");
		expect(button.disabled).toBe(false);
	});

	it("keeps replacement and revocation as separate active-state intents", function _ActiveIntents()
	{
		const fixture = _Mount(_View({ state: PersonalMcpConnectionControlStates.Active, canReplace: true, canRevoke: true }));
		const replace = vi.fn();
		const revoke = vi.fn();
		fixture.componentInstance.replaceRequested.subscribe(replace);
		fixture.componentInstance.revokeRequested.subscribe(revoke);
		(fixture.nativeElement.querySelector("button") as HTMLButtonElement).click();
		(fixture.nativeElement.querySelectorAll("button")[1] as HTMLButtonElement).click();
		expect(replace).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledOnce();
	});

	it("associates safe command errors and restores focus for replacement and cancellation", async function _Focus()
	{
		const fixture = _Mount(_View({ state: PersonalMcpConnectionControlStates.Active, canReplace: true }));
		_SetInput(fixture.componentInstance.view, _View({ state: PersonalMcpConnectionControlStates.Replace, draft: "" }));
		fixture.detectChanges();
		await fixture.whenStable();
		const input = fixture.nativeElement.querySelector("input") as HTMLInputElement;
		expect(document.activeElement).toBe(input);
		_SetInput(fixture.componentInstance.error, "Connection could not be confirmed.");
		fixture.detectChanges();
		await fixture.whenStable();
		expect(input.getAttribute("aria-describedby")).toContain("weather-connection-error");
		expect(fixture.nativeElement.querySelector("[role=alert]").textContent).toContain("could not be confirmed");
		_SetInput(fixture.componentInstance.view, _View({ state: PersonalMcpConnectionControlStates.Active, canReplace: true }));
		_SetInput(fixture.componentInstance.error, null);
		fixture.detectChanges();
		await fixture.whenStable();
		expect(document.activeElement).toBe(fixture.nativeElement.querySelector("button"));
	});

	it("renders removal without any connection action", function _Removing()
	{
		const fixture = _Mount(_View({ state: PersonalMcpConnectionControlStates.Removing, canReplace: true, canRevoke: true }));
		expect(fixture.nativeElement.textContent).toContain("removal is in progress");
		expect(fixture.nativeElement.querySelector("button")).toBeNull();
	});
});
