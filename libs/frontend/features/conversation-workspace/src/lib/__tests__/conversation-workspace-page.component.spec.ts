// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ɵresolveComponentResources as resolveComponentResources } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/adapter";
import { ConversationElicitationStore, ELICITATION_GATEWAY } from "@opencrane/state/conversation/elicitation";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationRunStore, ConversationWorkspaceStore, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspacePageComponent } from "../conversation-workspace-page.component.js";

/** Return an empty authorized workspace for component construction. */
class _WorkspaceGateway implements ConversationWorkspaceGateway
{
	/** Return no discoverable participants or personal Agent. */
	public async directory() { return { participants: [], personalAgentStatus: "unavailable" as const, personalAgent: null }; }
	/** Return no conversation rows. */
	public async list() { return []; }
	/** Reject an open command that this construction test never sends. */
	public async open(): Promise<ConversationWorkspaceDetail> { throw new Error("No conversation selected."); }
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
	/** Return the command's initial state without opening a network connection. */
	public async stream(command: StreamConversationEventsCommand) { return command.initialState; }
}

beforeAll(async function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	const pageTemplate = readFileSync(join(process.cwd(), "src/lib/conversation-workspace-page.component.html"), "utf8");
	await resolveComponentResources(async function _ResolveResource(url): Promise<string>
	{
		if (url.endsWith("conversation-workspace-page.component.html")) return pageTemplate;
		return "";
	});
});
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationWorkspacePageComponent", function _PageSuite()
{
	it("constructs its run, asset, elicitation, and workspace stores in one component scope", async function _ComponentScope()
	{
		TestBed.overrideComponent(ConversationWorkspacePageComponent, { set: { templateUrl: undefined, template: "", styleUrl: undefined, styleUrls: [], styles: [] } });
		TestBed.configureTestingModule({ imports: [ConversationWorkspacePageComponent], providers: [
			{ provide: CONVERSATION_WORKSPACE_GATEWAY, useClass: _WorkspaceGateway },
			{ provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: _EventStream },
			{ provide: CONVERSATION_ASSETS_GATEWAY, useValue: { list: vi.fn(), read: vi.fn(), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() } },
			{ provide: ELICITATION_GATEWAY, useValue: { read: vi.fn().mockResolvedValue({ version: CONVERSATION_ELICITATION_VERSION, requestId: "request-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "participant-1", purpose: ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.FreeText, prompt: "Question", maximumLength: 100, allowEmpty: false }, requiresStepUp: false, requestedAt: "2026-08-12T08:00:00.000Z", expiresAt: "2026-08-12T09:00:00.000Z" }), respond: vi.fn(), listActivity: vi.fn() } }
		] });

		const fixture = TestBed.createComponent(ConversationWorkspacePageComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(fixture.debugElement.injector.get(ConversationRunStore)).toBeInstanceOf(ConversationRunStore);
		expect(fixture.debugElement.injector.get(ConversationElicitationStore)).toBeInstanceOf(ConversationElicitationStore);
		expect(fixture.debugElement.injector.get(ConversationWorkspaceStore)).toBeInstanceOf(ConversationWorkspaceStore);
	});
});
