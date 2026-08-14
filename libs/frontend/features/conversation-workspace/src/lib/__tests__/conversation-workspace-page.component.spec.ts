// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/adapter";
import { ConversationElicitationStore, ELICITATION_GATEWAY, ElicitationGatewayError, ElicitationGatewayErrorKinds } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationRunStore, ConversationWorkspaceStore, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspacePageComponent } from "../conversation-workspace-page/conversation-workspace-page.component.js";

/** Return an empty authorized workspace for component construction. */
class _WorkspaceGateway implements ConversationWorkspaceGateway
{
	/** Optional authorized conversation used by full route-state tests. */
	private readonly _detail: ConversationWorkspaceDetail | null;

	/** Capture the optional authorized conversation. */
	public constructor(detail: ConversationWorkspaceDetail | null = null) { this._detail = detail; }

	/** Return no discoverable participants or personal Agent. */
	public async directory() { return { participants: [], personalAgentStatus: "unavailable" as const, personalAgent: null }; }
	/** Return the configured authorized row when present. */
	public async list() { return this._detail === null ? [] : [this._detail]; }
	/** Return the configured authorized conversation. */
	public async open(): Promise<ConversationWorkspaceDetail> { if (this._detail === null) throw new Error("No conversation selected."); return this._detail; }
	/** Reject an unused create command. */
	public async create(): Promise<ConversationWorkspaceDetail> { throw new Error("Create is unavailable."); }
	/** Accept no unused message command. */
	public async send(): Promise<void> { return; }
	/** Reject an unused archive command. */
	public async archive(): Promise<ConversationWorkspaceDetail> { throw new Error("Archive is unavailable."); }
	/** Reject an unused close command. */
	public async close(): Promise<ConversationWorkspaceDetail> { throw new Error("Close is unavailable."); }
	/** Reject an unused run read. */
	public async run(): Promise<never> { throw new Error("Run is unavailable."); }
	/** Accept no unused steering command. */
	public async steer(): Promise<void> { return; }
	/** Reject an unused cancellation command. */
	public async cancel(): Promise<never> { throw new Error("Cancellation is unavailable."); }
	/** Reject an unused retry command. */
	public async retry(): Promise<never> { throw new Error("Retry is unavailable."); }
}

/** Stream double that completes without retaining component state. */
class _EventStream implements ConversationEventStream
{
	/** Whether this stream revokes the previously visible conversation. */
	private readonly _accessRevoked: boolean;

	/** Capture whether the stream should exercise the access-loss path. */
	public constructor(accessRevoked = false) { this._accessRevoked = accessRevoked; }

	/** Emit one controlled projection without opening a network connection. */
	public async stream(command: StreamConversationEventsCommand)
	{
		const state = { ...command.initialState, accessRevoked: this._accessRevoked };
		command.onUpdate?.({ status: ConversationEventStreamStatuses.Live, state, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		return state;
	}
}

/** Build one authorized empty conversation for route-state tests. */
function _Conversation(): ConversationWorkspaceDetail
{
	return { id: "conversation-1", mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["participant-1"], archivedAt: null, updatedAt: "2026-08-12T08:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [] };
}

/** Build one requested free-text projection used by recovery tests. */
function _Elicitation()
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "participant-1", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Question", maximumLength: 100, allowEmpty: false }, requiresStepUp: false, requestedAt: "2026-08-12T08:00:00.000Z", expiresAt: "2026-08-12T09:00:00.000Z" } as const;
}

/** Configure every component-scoped port with a controlled elicitation gateway. */
function _Configure(elicitationGateway: { readonly read: ReturnType<typeof vi.fn>; readonly respond: ReturnType<typeof vi.fn>; readonly listActivity: ReturnType<typeof vi.fn> }, workspaceGateway: ConversationWorkspaceGateway = new _WorkspaceGateway(), eventStream: ConversationEventStream = new _EventStream()): void
{
	TestBed.configureTestingModule({ imports: [ConversationWorkspacePageComponent], providers: [
		{ provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: workspaceGateway },
		{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: eventStream },
		{ provide: CONVERSATION_ASSETS_GATEWAY, useValue: { list: vi.fn(), read: vi.fn(), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() } },
		{ provide: ELICITATION_GATEWAY, useValue: elicitationGateway }
	] });
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("response-key") });
	HTMLElement.prototype.scrollIntoView = vi.fn();
	const pageTemplate = readFileSync(join(process.cwd(), "src/lib/conversation-workspace-page/conversation-workspace-page.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("conversation-workspace-page.component.html")) return pageTemplate;
		return "";
	});
});
afterAll(function _ResetAngularTesting() { vi.unstubAllGlobals(); TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationWorkspacePageComponent", function _PageSuite()
{
	it("constructs its run, asset, elicitation, and workspace stores in one component scope", async function _ComponentScope()
	{
		TestBed.overrideComponent(ConversationWorkspacePageComponent, { set: { templateUrl: undefined, template: "", styleUrl: undefined, styleUrls: [], styles: [] } });
		_Configure({ read: vi.fn().mockResolvedValue(_Elicitation()), respond: vi.fn(), listActivity: vi.fn() });

		const fixture = TestBed.createComponent(ConversationWorkspacePageComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(fixture.debugElement.injector.get(ConversationRunStore)).toBeInstanceOf(ConversationRunStore);
		expect(fixture.debugElement.injector.get(ConversationElicitationStore)).toBeInstanceOf(ConversationElicitationStore);
		expect(fixture.debugElement.injector.get(ConversationWorkspaceStore)).toBeInstanceOf(ConversationWorkspaceStore);
	});

	it("forwards verified sign-in and restores focus to the original ask after reconciliation", async function _StepUpFocus()
	{
		TestBed.overrideComponent(ConversationWorkspacePageComponent, { set: { templateUrl: undefined, template: "<button id=\"request-1\">Original ask</button><button id=\"recover\" (click)=\"requestStepUp('/api/v1/auth/reauthenticate')\">Sign in again</button>", styleUrl: undefined, styleUrls: [], styles: [] } });
		const gateway = { read: vi.fn().mockResolvedValue(_Elicitation()), respond: vi.fn().mockRejectedValue(new ElicitationGatewayError(ElicitationGatewayErrorKinds.StepUpRequired, "/api/v1/auth/reauthenticate")), listActivity: vi.fn() };
		_Configure(gateway);
		const fixture = TestBed.createComponent(ConversationWorkspacePageComponent);
		const store = fixture.debugElement.injector.get(ConversationElicitationStore);
		const requested = vi.fn();
		fixture.componentInstance.stepUpRequested.subscribe(requested);
		fixture.detectChanges();
		await store.load("conversation-1", "request-1");
		store.select({ kind: ElicitationBodyKinds.FreeText, text: "Keep this answer" });
		await store.submit();
		fixture.nativeElement.querySelector("#recover").click();

		expect(requested).toHaveBeenCalledWith("/api/v1/auth/reauthenticate");
		await fixture.componentInstance.recoverAfterStepUp();
		fixture.detectChanges();
		await fixture.whenStable();

		expect(globalThis.document.activeElement?.id).toBe("request-1");
		expect(store.restoreFocusRequestId()).toBeNull();
	});

	it("focuses the access-change heading after a visible conversation is revoked", async function _AccessChangedFocus()
	{
		TestBed.overrideComponent(ConversationWorkspacePageComponent, { set: { templateUrl: undefined, template: "@if (store.routeState() === routeStates.AccessChanged) { <h1 #accessChangedHeading tabindex=\"-1\">Access changed</h1> }", styleUrl: undefined, styleUrls: [], styles: [] } });
		_Configure({ read: vi.fn(), respond: vi.fn(), listActivity: vi.fn().mockResolvedValue([]) }, new _WorkspaceGateway(_Conversation()), new _EventStream(true));

		const fixture = TestBed.createComponent(ConversationWorkspacePageComponent);
		fixture.autoDetectChanges();
		await fixture.whenStable();
		let heading: HTMLHeadingElement | null = null;
		await vi.waitFor(function _WaitForRevocation()
		{
			heading = fixture.nativeElement.querySelector("h1") as HTMLHeadingElement | null;
			expect(heading).not.toBeNull();
		});
		fixture.detectChanges();
		await fixture.whenStable();

		expect(heading!.textContent).toContain("Access changed");
		await vi.waitFor(function _WaitForFocus() { expect(globalThis.document.activeElement).toBe(heading); });
	});

	it("scrolls to and focuses an Activity target with a polite result", async function _ActivityFocus()
	{
		TestBed.overrideComponent(ConversationWorkspacePageComponent, { set: { templateUrl: undefined, template: "<button id=\"open-activity\" (click)=\"focusActivity({ conversationId: 'conversation-1', runId: 'run-1', toolCallId: 'tool-1' })\">Open activity</button><article id=\"tool-1\" tabindex=\"-1\">Tool call</article><p id=\"announcement\">{{ activityAnnouncement() }}</p>", styleUrl: undefined, styleUrls: [], styles: [] } });
		_Configure({ read: vi.fn(), respond: vi.fn(), listActivity: vi.fn().mockResolvedValue([]) });

		const fixture = TestBed.createComponent(ConversationWorkspacePageComponent);
		fixture.detectChanges();
		await fixture.whenStable();
		const destination = fixture.nativeElement.querySelector("#tool-1") as HTMLElement;
		fixture.nativeElement.querySelector("#open-activity").click();
		fixture.detectChanges();

		expect(destination.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
		expect(globalThis.document.activeElement).toBe(destination);
		expect(fixture.nativeElement.querySelector("#announcement").textContent).toContain("Opened the selected activity");
	});
});
