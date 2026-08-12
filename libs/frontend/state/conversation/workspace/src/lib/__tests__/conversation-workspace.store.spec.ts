// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/adapter";
import { __CreateAgUiStreamState } from "@opencrane/state/conversation/ag-ui";

import { ConversationRunStore } from "../conversation-run.store.js";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors.js";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway.js";
import { ConversationWorkspaceStore } from "../conversation-workspace.store.js";
import { ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates, type ConversationRun, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand, type RetryConversationRunCommand } from "../conversation-workspace.types.js";

/** Build one complete authorized conversation snapshot. */
function _Detail(id = "conversation-1"): ConversationWorkspaceDetail
{
	return { id, mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["self-ref", "other-ref"], archivedAt: null, updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [] };
}

/** Mutable gateway fake exposing exact store commands. */
class _FakeGateway implements ConversationWorkspaceGateway
{
	/** Next open outcome. */
	public openResult: ConversationWorkspaceDetail | Error = _Detail();
	/** Created immutable-mode commands. */
	public readonly created: CreateConversationCommand[] = [];
	/** Submitted message copy. */
	public readonly sent: string[] = [];

	/** Return generic privacy-safe choices. */
	public async directory() { return { participants: [{ participantRef: "self-ref", isSelf: true, label: "You" }, { participantRef: "other-ref", isSelf: false, label: "Participant 1" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } } as const; }
	/** Return one current row. */
	public async list() { return [_Detail()]; }
	/** Resolve the configured open outcome. */
	public async open(): Promise<ConversationWorkspaceDetail> { if (this.openResult instanceof Error) throw this.openResult; return this.openResult; }
	/** Record and return one created snapshot. */
	public async create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail> { this.created.push(command); return { ..._Detail("created-1"), mode: command.mode }; }
	/** Record one message body. */
	public async send(_conversationId: string, text: string): Promise<void> { this.sent.push(text); }
	/** Return an archived snapshot. */
	public async archive() { return { ..._Detail(), archivedAt: "2026-08-12T10:00:00.000Z" }; }
	/** Return a closed snapshot. */
	public async close() { return { ..._Detail(), lifecycle: ConversationLifecycles.Closed }; }
	/** Return one run status. */
	public async run(runId: string): Promise<ConversationRun> { return { runId, attempt: 1, state: "running" as ConversationRun["state"], conversationId: "conversation-1" }; }
	/** Accept steering. */
	public async steer(): Promise<void> { return; }
	/** Return a cancelled run. */
	public async cancel(runId: string, expectedAttempt: number): Promise<ConversationRun> { return { runId, attempt: expectedAttempt, state: "cancelled" as ConversationRun["state"], conversationId: "conversation-1" }; }
	/** Return a fresh retry attempt. */
	public async retry(command: RetryConversationRunCommand): Promise<ConversationRun> { return { runId: command.runId, attempt: command.expectedAttempt + 1, state: "accepted" as ConversationRun["state"], conversationId: command.conversationId }; }
}

/** Stream fake that emits one live phase and then waits for abort. */
class _FakeStream implements ConversationEventStream
{
	/** Number of selected streams started. */
	public starts = 0;

	/** Emit one update without retaining the command. */
	public async stream(command: StreamConversationEventsCommand)
	{
		this.starts += 1;
		const state = __CreateAgUiStreamState();
		command.onUpdate?.({ status: ConversationEventStreamStatuses.Live, state, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		return state;
	}
}

/** Create one component-scoped store and fakes. */
function _CreateStore(): readonly [ConversationWorkspaceStore, _FakeGateway, _FakeStream]
{
	const gateway = new _FakeGateway();
	const stream = new _FakeStream();
	TestBed.configureTestingModule({ providers: [ConversationRunStore, ConversationWorkspaceStore, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }] });
	return [TestBed.inject(ConversationWorkspaceStore), gateway, stream];
}

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("command-key") });
});

afterAll(function _ResetAngularTesting()
{
	vi.unstubAllGlobals();
	TestBed.resetTestEnvironment();
});

afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationWorkspaceStore", function _ConversationWorkspaceStore()
{
	it("loads the directory and first snapshot before starting the live tail", async function _SnapshotTail()
	{
		const [store, _gateway, stream] = _CreateStore();
		await store.load();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Ready);
		expect(store.selected()?.id).toBe("conversation-1");
		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.Live);
		expect(stream.starts).toBe(1);
	});

	it("creates the fixed selected mode with opaque coordinates only", async function _CreateDirect()
	{
		const [store, gateway] = _CreateStore();
		await store.load();
		store.selectCreationMode(ConversationModes.Direct);
		store.toggleParticipant("other-ref");
		expect(store.canCreate()).toBe(true);
		expect(await store.create()).toBe(true);
		expect(gateway.created).toEqual([{ mode: ConversationModes.Direct, participantRefs: ["other-ref"] }]);
	});

	it("retains a message draft while the live stream reconnects", async function _ReconnectDraft()
	{
		const [store] = _CreateStore();
		await store.load();
		store.updateDraft("Keep this draft");
		expect(store.draft()).toBe("Keep this draft");
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Ready);
	});

	it("purges a previously visible snapshot and draft on proven access loss", async function _AccessLoss()
	{
		const [store, gateway] = _CreateStore();
		await store.load();
		store.updateDraft("Private draft");
		gateway.openResult = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is no longer available.");
		await store.open("conversation-1");
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged);
		expect(store.selected()).toBeNull();
		expect(store.draft()).toBe("");
		expect(store.live().accessRevoked).toBe(false);
	});
});
