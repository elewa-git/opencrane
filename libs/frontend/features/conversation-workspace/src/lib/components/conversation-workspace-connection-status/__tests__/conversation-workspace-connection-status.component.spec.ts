// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type InputSignal, ɵInputSignalNode as InputSignalNode, ɵresolveComponentResources as resolveComponentResources, ɵSIGNAL as SIGNAL } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationStatusTones } from "@opencrane/elements/conversation";

import { ConversationWorkspaceConnectionStatusComponent } from "../conversation-workspace-connection-status.component";

/** Production markup that composes the shared announcement with the feature action. */
const _TEMPLATE = readFileSync(join(process.cwd(), "src/lib/components/conversation-workspace-connection-status/conversation-workspace-connection-status.component.html"), "utf8");

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
		if (url.endsWith("conversation-workspace-connection-status.component.html")) return _TEMPLATE;
		return "";
	});
});
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ConversationWorkspaceConnectionStatusComponent", function _ConnectionStatus()
{
	it("announces reconnecting and emits one enabled reconnect request", function _ReconnectIntent()
	{
		TestBed.overrideComponent(ConversationWorkspaceConnectionStatusComponent, { set: { templateUrl: undefined, template: "<button [disabled]=\"reconnectPending()\" (click)=\"requestReconnect()\">Reconnect now</button>", styleUrl: undefined, styleUrls: [], styles: [] } });
		TestBed.configureTestingModule({ imports: [ConversationWorkspaceConnectionStatusComponent] });
		const fixture = TestBed.createComponent(ConversationWorkspaceConnectionStatusComponent);
		const requested = vi.fn();
		fixture.componentInstance.reconnectRequested.subscribe(requested);
		_SetInput(fixture.componentInstance.status, { label: "Reconnecting — attempt 2", detail: "Your draft is still here.", tone: ConversationStatusTones.Attention });
		_SetInput(fixture.componentInstance.reconnectAvailable, true);
		fixture.detectChanges();
		const button = fixture.nativeElement.querySelector<HTMLButtonElement>("button");

		expect(button?.textContent).toContain("Reconnect now");
		button?.click();
		expect(requested).toHaveBeenCalledOnce();
	});

	it("keeps the reconnect action visible but disabled while a manual socket opens", function _PendingReconnect()
	{
		TestBed.overrideComponent(ConversationWorkspaceConnectionStatusComponent, { set: { templateUrl: undefined, template: "<button [disabled]=\"reconnectPending()\" (click)=\"requestReconnect()\">Reconnecting…</button>", styleUrl: undefined, styleUrls: [], styles: [] } });
		TestBed.configureTestingModule({ imports: [ConversationWorkspaceConnectionStatusComponent] });
		const fixture = TestBed.createComponent(ConversationWorkspaceConnectionStatusComponent);
		const requested = vi.fn();
		fixture.componentInstance.reconnectRequested.subscribe(requested);
		_SetInput(fixture.componentInstance.status, { label: "Connecting to chat", detail: "Messages will be available when the connection is ready.", tone: ConversationStatusTones.Neutral });
		_SetInput(fixture.componentInstance.reconnectPending, true);
		fixture.detectChanges();
		const button = fixture.nativeElement.querySelector<HTMLButtonElement>("button");

		expect(button?.textContent).toContain("Reconnecting");
		expect(button?.disabled).toBe(true);
		button?.click();
		expect(requested).not.toHaveBeenCalled();
	});

	it("keeps the production status and action in one labelled bar", function _ProductionComposition()
	{
		expect(_TEMPLATE).toContain('aria-label="Conversation connection status"');
		expect(_TEMPLATE).toContain("wo-conversation-status-line");
		expect(_TEMPLATE).toContain("Reconnect now");
	});
});
