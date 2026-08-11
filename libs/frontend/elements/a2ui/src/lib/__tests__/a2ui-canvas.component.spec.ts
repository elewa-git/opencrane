// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLATFORM_ID, Component, signal, ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AG_UI_A2UI_ENVELOPE_VERSION, AgUiA2uiSurfaceStates, type AgUiA2uiOperation } from "@opencrane/contracts";

import { A2uiCanvasComponent } from "../a2ui-canvas.component.js";
import { provideOpenCraneA2ui } from "../a2ui.providers.js";
import { type A2uiDisplayedActionIntent, type A2uiSurfacePresentation } from "../a2ui.types.js";

/** Real component template compiled by Angular TestBed for DOM and accessibility contracts. */
const _CANVAS_TEMPLATE = readFileSync(join(process.cwd(), "src/lib/a2ui-canvas.component.html"), "utf8");

/** Real component styles resolved with the template so TestBed exercises the production component. */
const _CANVAS_STYLES = readFileSync(join(process.cwd(), "src/lib/a2ui-canvas.component.scss"), "utf8");

/** Canonical lifecycle label, busy state, and server/browser authority cases. */
const _STATE_CASES: readonly (readonly [AgUiA2uiSurfaceStates, string, boolean])[] =
[
	[AgUiA2uiSurfaceStates.Streaming, "Streaming", true],
	[AgUiA2uiSurfaceStates.Ready, "Ready", false],
	[AgUiA2uiSurfaceStates.ActionPending, "Action pending", true],
	[AgUiA2uiSurfaceStates.Submitted, "Submitted", false],
	[AgUiA2uiSurfaceStates.ValidationError, "Validation error", false],
	[AgUiA2uiSurfaceStates.ActionFailed, "Action failed", false],
	[AgUiA2uiSurfaceStates.Expired, "Expired", false],
	[AgUiA2uiSurfaceStates.AlreadyUsed, "Already used", false],
	[AgUiA2uiSurfaceStates.Unauthorized, "Unauthorized", false],
	[AgUiA2uiSurfaceStates.Unsupported, "Unsupported", false]
];

/** Test-only host that supplies the required input during Angular component creation. */
@Component({
	selector: "wo-a2ui-canvas-test-host",
	standalone: true,
	imports: [A2uiCanvasComponent],
	template: `
		@if (presentation(); as currentPresentation)
		{
			<wo-a2ui-canvas [presentation]="currentPresentation" (displayedAction)="captureIntent($event)" />
		}
	`
})
class _A2uiCanvasTestHostComponent
{
	/** Controlled server projection bound through the real Angular input contract. */
	public readonly presentation = signal<A2uiSurfacePresentation | null>(null);

	/** Displayed intents captured from the real Angular output contract. */
	public readonly intents: A2uiDisplayedActionIntent[] = [];

	/** Capture one intent without making the host an authorization or command owner. */
	public captureIntent(intent: A2uiDisplayedActionIntent): void
	{
		this.intents.push(intent);
	}
}

/** Produce the reviewed interactive surface while retaining stable component ids across updates. */
function _surfaceOperations(copy: string, includeBeginRendering = true): readonly AgUiA2uiOperation[]
{
	const operations: AgUiA2uiOperation[] =
	[
		{
			surfaceUpdate:
			{
				surfaceId: "surface-pricing",
				components:
				[
					{ id: "pricing-form", component: { List: { children: { explicitList: ["pricing-copy", "pricing-reason", "apply-button"] }, direction: "vertical", alignment: "stretch" } } },
					{ id: "pricing-copy", component: { Text: { text: { literalString: copy }, usageHint: "h3" } } },
					{ id: "pricing-reason", component: { TextField: { label: { literalString: "Reason" }, text: { literalString: "Validated customer evidence" }, textFieldType: "shortText" } } },
					{ id: "apply-label", component: { Text: { text: { literalString: "Request approval" }, usageHint: "body" } } },
					{ id: "apply-button", component: { Button: { child: "apply-label", primary: true, action: { name: "apply-pricing", context: [{ key: "decision", value: { literalString: "apply" } }] } } } }
				]
			}
		}
	];
	if (includeBeginRendering)
	{
		operations.push({ beginRendering: { surfaceId: "surface-pricing", root: "pricing-form" } });
	}
	return operations;
}

/** Build one full-coordinate presentation while allowing a focused test to replace fields. */
function _presentation(overrides: Partial<A2uiSurfacePresentation> = {}): A2uiSurfacePresentation
{
	return {
		version: AG_UI_A2UI_ENVELOPE_VERSION,
		conversationId: "conversation-1",
		runId: "run-1",
		messageId: "message-1",
		surfaceId: "surface-pricing",
		sequence: 1,
		state: AgUiA2uiSurfaceStates.Ready,
		operations: _surfaceOperations("Apply the proposed pricing?"),
		...overrides
	};
}

/** Test-only sanitizer proving the required port without allowing story or test HTML execution. */
function _sanitize(markdown: string): string
{
	return markdown.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Create and settle the production component with its real A2UI providers. */
async function _createFixture(presentation: A2uiSurfacePresentation): Promise<ComponentFixture<_A2uiCanvasTestHostComponent>>
{
	TestBed.configureTestingModule({ imports: [_A2uiCanvasTestHostComponent], providers: [...provideOpenCraneA2ui(_sanitize), { provide: PLATFORM_ID, useValue: "server" }] });
	const fixture = TestBed.createComponent(_A2uiCanvasTestHostComponent);
	fixture.componentInstance.presentation.set(presentation);
	fixture.detectChanges();
	await fixture.whenStable();
	fixture.detectChanges();
	return fixture;
}

/** Adopt a later input sequence and settle the component's signal effects and dynamic renderer. */
async function _adopt(fixture: ComponentFixture<_A2uiCanvasTestHostComponent>, presentation: A2uiSurfacePresentation): Promise<void>
{
	fixture.componentInstance.presentation.set(presentation);
	fixture.detectChanges();
	await fixture.whenStable();
	fixture.detectChanges();
}

/** Read one required production DOM element and fail with the selector when it is absent. */
function _requiredElement<TElement extends Element>(fixture: ComponentFixture<_A2uiCanvasTestHostComponent>, selector: string): TElement
{
	const element = (fixture.nativeElement as HTMLElement).querySelector<TElement>(selector);
	expect(element, `Expected ${selector} in A2UI canvas`).not.toBeNull();
	return element as TElement;
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveComponentResource(url): Promise<string>
	{
		if (url.endsWith("a2ui-canvas.component.html"))
		{
			return _CANVAS_TEMPLATE;
		}
		if (url.endsWith("a2ui-canvas.component.scss"))
		{
			return _CANVAS_STYLES;
		}
		return "";
	});
});

afterAll(function _ResetAngularTesting()
{
	TestBed.resetTestEnvironment();
});

afterEach(function _ResetTestingModule()
{
	TestBed.resetTestingModule();
});

describe("A2UI canvas DOM contract", function _A2uiCanvasDomContract()
{
	it("renders and announces every canonical lifecycle from the shared contract", async function _RendersEveryLifecycle()
	{
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.Streaming, reason: "Safe projected reason." }));
		for (let index = 0; index < _STATE_CASES.length; index += 1)
		{
			const [state, label, busy] = _STATE_CASES[index];
			await _adopt(fixture, _presentation({ sequence: index + 1, state, reason: "Safe projected reason." }));
			const host = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas");
			const status = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas__state");
			expect(host.dataset["state"]).toBe(state);
			expect(host.getAttribute("aria-busy")).toBe(String(busy));
			expect(status.textContent).toContain(label);
			expect(status.getAttribute("aria-live")).toBe("polite");
		}
	});

	it("keeps preparing and unsupported status content outside the inert interactive surface", async function _KeepsStatusAccessible()
	{
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.Streaming, operations: [] }));
		const preparing = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas__placeholder");
		expect(preparing.getAttribute("role")).toBe("status");
		expect(preparing.closest("[inert]")).toBeNull();
		expect((fixture.nativeElement as HTMLElement).querySelector("[aria-disabled]")).toBeNull();

		await _adopt(fixture, _presentation({ sequence: 2, state: AgUiA2uiSurfaceStates.Unsupported, reason: "Hidden provider detail" }));
		const unsupported = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas__placeholder");
		expect(unsupported.getAttribute("role")).toBe("note");
		expect(unsupported.closest("[inert]")).toBeNull();
		expect(unsupported.textContent).not.toContain("Hidden provider detail");
	});

	it("applies inert and aria-disabled only to a rendered non-ready interactive surface", async function _DisablesOnlyInteractiveSurface()
	{
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.ActionPending }));
		const surface = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas__surface");
		expect(surface.hasAttribute("inert")).toBe(true);
		expect(surface.getAttribute("aria-disabled")).toBe("true");

		await _adopt(fixture, _presentation({ sequence: 2, state: AgUiA2uiSurfaceStates.Ready }));
		expect(surface.hasAttribute("inert")).toBe(false);
		expect(surface.hasAttribute("aria-disabled")).toBe(false);
	});

	it("emits one full-coordinate intent only from a ready displayed action", async function _EmitsFullCoordinateIntent()
	{
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.ActionPending }));
		_requiredElement<HTMLButtonElement>(fixture, "button").click();
		await fixture.whenStable();
		expect(fixture.componentInstance.intents).toEqual([]);

		await _adopt(fixture, _presentation({ sequence: 2, state: AgUiA2uiSurfaceStates.Ready }));
		_requiredElement<HTMLButtonElement>(fixture, "button").click();
		await fixture.whenStable();
		expect(fixture.componentInstance.intents).toEqual(
		[
			{
				version: AG_UI_A2UI_ENVELOPE_VERSION,
				conversationId: "conversation-1",
				runId: "run-1",
				messageId: "message-1",
				surfaceId: "surface-pricing",
				sequence: 2,
				displayedActionId: "apply-pricing",
				sourceComponentId: "apply-button",
				values: { decision: "apply" }
			}
		]);
		expect(fixture.componentInstance.intents[0]).not.toHaveProperty("timestamp");
		expect(fixture.componentInstance.intents[0]).not.toHaveProperty("completion");
	});

	it("preserves the focused input across progressive updates with stable component ids", async function _PreservesProgressiveFocus()
	{
		const initialOperations = _surfaceOperations("Apply the proposed pricing?");
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.Streaming, operations: initialOperations }));
		const focusedInput = _requiredElement<HTMLInputElement>(fixture, "input");
		focusedInput.focus();
		expect(document.activeElement).toBe(focusedInput);

		await _adopt(fixture, _presentation({ sequence: 2, state: AgUiA2uiSurfaceStates.Ready, operations: [...initialOperations, ..._surfaceOperations("Pricing evidence is ready.", false)] }));
		const updatedInput = _requiredElement<HTMLInputElement>(fixture, "input");
		expect(updatedInput).toBe(focusedInput);
		expect(document.activeElement).toBe(focusedInput);
		expect((fixture.nativeElement as HTMLElement).textContent).toContain("Pricing evidence is ready.");
	});

	it("ignores duplicate and stale sequences for both rendering and lifecycle", async function _RejectsStaleSequence()
	{
		const fixture = await _createFixture(_presentation({ sequence: 5, state: AgUiA2uiSurfaceStates.Ready, operations: _surfaceOperations("Newest projection") }));
		await _adopt(fixture, _presentation({ sequence: 4, state: AgUiA2uiSurfaceStates.ActionFailed, operations: _surfaceOperations("Stale projection", false), reason: "Stale failure" }));
		const host = _requiredElement<HTMLElement>(fixture, ".a2ui-canvas");
		expect(host.dataset["state"]).toBe(AgUiA2uiSurfaceStates.Ready);
		expect((fixture.nativeElement as HTMLElement).textContent).toContain("Newest projection");
		expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("Stale projection");
		expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("Stale failure");
	});

	it("fails unsupported and malformed component payloads to one non-disclosing placeholder", async function _SuppressesUnsupportedPayload()
	{
		const secretOperation =
		{
			surfaceUpdate:
			{
				surfaceId: "surface-pricing",
				components: [{ id: "unsafe", component: { RawHtml: { html: "TOP SECRET PROVIDER PAYLOAD" } } }]
			}
		} as unknown as AgUiA2uiOperation;
		const fixture = await _createFixture(_presentation({ state: AgUiA2uiSurfaceStates.Unsupported, operations: [secretOperation], reason: "TOP SECRET REASON" }));
		let text = (fixture.nativeElement as HTMLElement).textContent ?? "";
		expect(text).toContain("This interactive surface is not supported.");
		expect(text).not.toContain("TOP SECRET");
		expect((fixture.nativeElement as HTMLElement).querySelector("a2ui-surface")).toBeNull();

		await _adopt(fixture, _presentation({ sequence: 2, state: AgUiA2uiSurfaceStates.Ready, operations: [secretOperation], reason: "TOP SECRET REASON" }));
		text = (fixture.nativeElement as HTMLElement).textContent ?? "";
		expect(text).toContain("This interactive surface is not supported.");
		expect(text).not.toContain("TOP SECRET");
	});
});
