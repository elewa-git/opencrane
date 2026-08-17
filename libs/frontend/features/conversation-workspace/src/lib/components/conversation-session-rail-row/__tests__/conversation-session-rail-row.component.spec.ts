// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type InputSignal, ɵInputSignalNode as InputSignalNode, ɵresolveComponentResources as resolveComponentResources, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationSessionRailIconStates, ConversationSessionRailItemKinds, type ConversationSessionRailItemPresentation } from "../../../conversation-workspace-feature.types";
import { ConversationSessionRailRowComponent } from "../conversation-session-rail-row.component";

/** Builds a display-safe row for component contract tests. */
function _Item(overrides: Partial<ConversationSessionRailItemPresentation> = {}): ConversationSessionRailItemPresentation
{
	return { key: "onboarding:onboarding-1", kind: ConversationSessionRailItemKinds.Onboarding, conversationId: null, title: "Welcome", iconState: ConversationSessionRailIconStates.Completed, archived: false, ...overrides };
}

/** Sets a signal input directly because source-mode JIT metadata cannot discover `input()` fields. */
function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	const template = readFileSync(join(process.cwd(), "src/lib/components/conversation-session-rail-row/conversation-session-rail-row.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("conversation-session-rail-row.component.html")) return template;
		return "";
	});
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationSessionRailRowComponent", function _ConversationSessionRailRowSuite()
{
	it("renders a selected completed session as one semantic row", function _SelectedCompletedRow()
	{
		TestBed.configureTestingModule({ imports: [ConversationSessionRailRowComponent] });
		const fixture = TestBed.createComponent(ConversationSessionRailRowComponent);
		_SetInput(fixture.componentInstance.item, _Item());
		_SetInput(fixture.componentInstance.selected, true);
		fixture.detectChanges();

		const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
		expect(button.getAttribute("aria-current")).toBe("page");
		expect(button.getAttribute("aria-label")).toBe("Welcome, completed");
		expect(button.textContent?.trim()).toBe("Welcome");
		expect(button.querySelector("i")?.getAttribute("aria-hidden")).toBe("true");
		expect(button.querySelector("small")).toBeNull();
		expect(button.querySelector("time")).toBeNull();
	});

	it("retains chat type while dimming an archived row and emitting selection", function _ArchivedTypeRow()
	{
		TestBed.configureTestingModule({ imports: [ConversationSessionRailRowComponent] });
		const fixture = TestBed.createComponent(ConversationSessionRailRowComponent);
		const item = _Item({ key: "group-1", kind: ConversationSessionRailItemKinds.Conversation, conversationId: "group-1", title: "Project handoff", iconState: ConversationSessionRailIconStates.Group, archived: true });
		const selected = vi.fn();
		fixture.componentInstance.selectionRequested.subscribe(selected);
		_SetInput(fixture.componentInstance.item, item);
		fixture.detectChanges();

		const button = fixture.nativeElement.querySelector("button") as HTMLButtonElement;
		expect(button.classList).toContain("conversation-session-rail-row--archived");
		expect(button.getAttribute("aria-label")).toBe("Project handoff, group chat");
		expect(button.querySelector("i")?.classList).toContain("pi-users");
		button.click();
		expect(selected).toHaveBeenCalledWith(item);
	});
});
