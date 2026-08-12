// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type InputSignal, ɵInputSignalNode as InputSignalNode, ɵSIGNAL as SIGNAL, ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AvatarTones } from "@opencrane/elements/ui";

import { ConversationComposerComponent } from "../conversation-composer.component.js";
import { ConversationMessageComponent } from "../conversation-message.component.js";
import { ConversationStatusLineComponent } from "../conversation-status-line.component.js";
import { ConversationComposerStates, ConversationMessageTones, ConversationStatusTones, type ConversationMessagePresentation, type ConversationStatusPresentation } from "../conversation.types.js";

/** Production templates resolved by Angular TestBed. */
const _RESOURCES: Readonly<Record<string, string>> = {
	"conversation-composer.component.html": readFileSync(join(process.cwd(), "src/lib/conversation-composer.component.html"), "utf8"),
	"conversation-message.component.html": readFileSync(join(process.cwd(), "src/lib/conversation-message.component.html"), "utf8"),
	"conversation-status-line.component.html": readFileSync(join(process.cwd(), "src/lib/conversation-status-line.component.html"), "utf8"),
	"avatar-circle.component.html": readFileSync(join(process.cwd(), "../ui/src/lib/components/avatar-circle/avatar-circle.component.html"), "utf8")
};

/** Create and settle one production element through Angular's public input contract. */
async function _Fixture<TComponent>(component: new (...args: never[]) => TComponent): Promise<ComponentFixture<TComponent>>
{
	TestBed.configureTestingModule({ imports: [component] });
	const fixture = TestBed.createComponent(component);
	return fixture;
}

/** Set a signal input directly because source-mode JIT metadata cannot discover input() fields. */
function _SetInput<TValue>(target: InputSignal<TValue>, value: TValue): void
{
	const node = target[SIGNAL] as InputSignalNode<TValue, TValue>;
	node.applyValueToInputSignal(node, value);
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith(".scss")) return "";
		const resource = Object.entries(_RESOURCES).find(([name]) => url.endsWith(name));
		return resource?.[1] ?? "<ng-content />";
	});
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("conversation elements", function _ConversationElements()
{
	it("retains exact message and assertive status presentations", function _RetainsPresentations()
	{
		const message: ConversationMessagePresentation = { id: "message-one", authorName: "Alex", authorInitials: "AK", avatarTone: AvatarTones.Blue, timestampLabel: "11:07", body: "Compare the proposal", tone: ConversationMessageTones.Participant };
		const messageComponent = TestBed.runInInjectionContext(function _ConstructMessage() { return new ConversationMessageComponent(); });
		_SetInput(messageComponent.message, message);
		expect(messageComponent.message()).toEqual(message);

		const status: ConversationStatusPresentation = { label: "Run failed", detail: "Nothing changed", tone: ConversationStatusTones.Danger, assertive: true };
		const statusComponent = TestBed.runInInjectionContext(function _ConstructStatus() { return new ConversationStatusLineComponent(); });
		_SetInput(statusComponent.status, status);
		expect(statusComponent.status()).toEqual(status);
	});

	it("emits the controlled draft only while available", async function _SubmitsAvailableDraft()
	{
		const fixture = await _Fixture(ConversationComposerComponent);
		const submitted: string[] = [];
		fixture.componentInstance.submitted.subscribe(function _Capture(value) { submitted.push(value); });
		_SetInput(fixture.componentInstance.draft, "Follow up");
		_SetInput(fixture.componentInstance.state, ConversationComposerStates.Available);
		fixture.detectChanges();
		(fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		fixture.detectChanges();
		expect(submitted).toEqual(["Follow up"]);
		_SetInput(fixture.componentInstance.state, ConversationComposerStates.Disabled);
		fixture.detectChanges();
		(fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		expect(submitted).toEqual(["Follow up"]);
	});
});
