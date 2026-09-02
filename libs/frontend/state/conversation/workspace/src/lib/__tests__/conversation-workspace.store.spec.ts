// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds, MessageRoles } from "@opencrane/models/conversations";
import { AgUiMessageStatuses, __CreateAgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { ConversationRunStore } from "../conversation-run.store";
import { ConversationOnboardingHistoryStore } from "../conversation-onboarding-history.store";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates, type ConversationOnboardingHistoryProjection, type ConversationRun, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand, type RetryConversationRunCommand, type SubmitConversationMessageCommand } from "../conversation-workspace.types";

/** Build one completed read-only onboarding exchange. */
function _OnboardingHistory(): ConversationOnboardingHistoryProjection
{
	return { status: ConversationOnboardingHistoryStatuses.Ready, history: { id: "onboarding-1", personaDisplayName: "Nova", startedAt: "2026-08-12T08:00:00.000Z", completedAt: "2026-08-12T08:05:00.000Z", transcript: [{ ordinal: 1, role: MessageRoles.Assistant, text: "Welcome" }, { ordinal: 2, role: MessageRoles.User, text: "Hello" }] } };
}

/** Build one complete authorized conversation snapshot. */
function _Detail(id = "conversation-1"): ConversationWorkspaceDetail
{
	return { id, mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["self-ref", "other-ref"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [] };
}

/** Controllable promise used to prove stale load completions cannot mutate current state. */
function _Deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void }
{
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(function _Wait(complete) { resolve = complete; });
	return { promise, resolve };
}

/** Mutable gateway fake exposing exact store commands. */
class _FakeGateway implements ConversationWorkspaceGateway
{
	/** Current conversation summaries returned to the selected workspace. */
	public listResult: readonly ConversationWorkspaceDetail[] = [_Detail()];
	/** Controlled archive completion for mutation race tests. */
	public archiveResult: Promise<ConversationWorkspaceDetail> | null = null;
	/** Controlled create completion for mutation race tests. */
	public createResult: Promise<ConversationWorkspaceDetail> | null = null;
	/** Created immutable-mode commands. */
	public readonly created: CreateConversationCommand[] = [];
	/** Submitted exact message commands. */
	public readonly sent: SubmitConversationMessageCommand[] = [];
	/** Optional send failure used to model ambiguous transport outcomes. */
	public sendError: Error | null = null;
	/** Optional pending send used to prove a replacement socket cannot retain a stale submitting state. */
	public sendResult: Promise<void> | null = null;
	/** Optional onboarding history outcome. */
	public historyResult: ConversationOnboardingHistoryProjection | Promise<ConversationOnboardingHistoryProjection> = _OnboardingHistory();
	/** Number of run reads admitted by the selected immutable mode. */
	public runReads = 0;

	/** Return generic privacy-safe choices. */
	public async directory() { return { participants: [{ participantRef: "self-ref", isSelf: true, label: "You" }, { participantRef: "other-ref", isSelf: false, label: "Participant 1" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } } as const; }
	/** Return the configured current rows. */
	public async list() { return this.listResult; }
	/** Return the configured separate onboarding history projection. */
	public async onboardingHistory() { return await this.historyResult; }
	/** Return a detail for the compatibility read port, which this socket-only store does not call. */
	public async open(conversationId: string): Promise<ConversationWorkspaceDetail> { return _Detail(conversationId); }
	/** Record and return one created snapshot. */
	public async create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail> { this.created.push(command); return this.createResult ?? { ..._Detail("created-1"), mode: command.mode }; }
	/** Record one exact message command before returning its controlled outcome. */
	public async send(command: SubmitConversationMessageCommand): Promise<void>
	{
		this.sent.push(command);
		await this.sendResult;
		if (this.sendError !== null) throw this.sendError;
	}
	/** Return an archived snapshot. */
	public async archive() { return this.archiveResult ?? { ..._Detail(), archivedAt: "2026-08-12T10:00:00.000Z" }; }
	/** Return a closed snapshot. */
	public async close() { return { ..._Detail(), lifecycle: ConversationLifecycles.Closed }; }
	/** Return one run status. */
	public async run(runId: string): Promise<ConversationRun> { this.runReads += 1; return { runId, attempt: 1, state: "running" as ConversationRun["state"], conversationId: "conversation-1" }; }
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
	/** Commands retained so tests can prove late socket updates cannot cross a manual reconnect. */
	public readonly commands: StreamConversationEventsCommand[] = [];
	/** Connection state emitted by the next selected stream. */
	public status = ConversationEventStreamStatuses.Live;
	/** Folded stream state emitted by the next selected stream. */
	public state = __CreateAgUiStreamState();

	/** Emit one update without retaining the command. */
	public async stream(command: StreamConversationEventsCommand)
	{
		this.starts += 1;
		this.commands.push(command);
		const state = this.state;
		command.onUpdate?.({ status: this.status, state, reconnectAttempt: this.status === ConversationEventStreamStatuses.Reconnecting ? 1 : 0, lastHeartbeatAt: Date.now() });
		return state;
	}

	/** Reject participant commands because the store test double owns projection only. */
	public async submit(): Promise<never> { throw new Error("Test stream does not submit messages."); }
}

/** Create one component-scoped store and fakes. */
function _CreateStore(): readonly [ConversationWorkspaceStore, _FakeGateway, _FakeStream]
{
	const gateway = new _FakeGateway();
	const stream = new _FakeStream();
	TestBed.configureTestingModule({ providers: [ConversationOnboardingHistoryStore, ConversationRunStore, ConversationWorkspaceStore, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }] });
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
	it("loads the directory and leaves onboarding history selected until a conversation is chosen", async function _OnboardingTail()
	{
		const [store, _gateway, stream] = _CreateStore();
		await store.load();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Ready);
		expect(store.onboardingHistorySelected()).toBe(true);
		expect(store.onboardingHistory().history?.id).toBe("onboarding-1");
		expect(store.selected()).toBeNull();
		expect(stream.starts).toBe(0);
	});

	it("rejects attempted message writes while onboarding history is selected", async function _ReadOnlyOnboardingHistory()
	{
		const [store, gateway] = _CreateStore();
		await store.load();
		store.updateDraft("Try to write into history");

		expect(store.canSend()).toBe(false);
		expect(await store.send()).toBe(false);
		expect(gateway.sent).toEqual([]);
	});

	it("opens an authorized direct URL selection instead of retaining default history", async function _DirectSelection()
	{
		const [store, _gateway, stream] = _CreateStore();
		await store.load();
		await store.open("conversation-1");

		expect(store.onboardingHistorySelected()).toBe(false);
		expect(store.selected()?.id).toBe("conversation-1");
		expect(stream.starts).toBe(1);
	});

	it("falls back to the first active conversation when no onboarding transcript was recorded", async function _MigratedFallback()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		expect(store.onboardingHistorySelected()).toBe(false);
		expect(store.selected()?.id).toBe("conversation-1");
		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.Live);
		expect(stream.starts).toBe(1);
	});

	it("rejects a stale onboarding-history completion after a newer workspace load", async function _StaleHistoryLoad()
	{
		const [store, gateway] = _CreateStore();
		const staleHistory = _Deferred<ConversationOnboardingHistoryProjection>();
		const currentHistory = _Deferred<ConversationOnboardingHistoryProjection>();
		gateway.historyResult = staleHistory.promise;
		const staleLoad = store.load();
		gateway.historyResult = currentHistory.promise;
		const currentLoad = store.load();

		currentHistory.resolve({ status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null });
		await currentLoad;
		expect(store.selected()?.id).toBe("conversation-1");
		expect(store.onboardingHistory().status).toBe(ConversationOnboardingHistoryStatuses.NotRecorded);

		staleHistory.resolve(_OnboardingHistory());
		await staleLoad;
		expect(store.selected()?.id).toBe("conversation-1");
		expect(store.onboardingHistory().status).toBe(ConversationOnboardingHistoryStatuses.NotRecorded);
	});

	it("creates the fixed selected mode with opaque coordinates only", async function _CreateDirect()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.selectCreationMode(ConversationModes.Direct);
		store.toggleParticipant("other-ref");
		expect(store.canCreate()).toBe(true);
		expect(await store.create()).toEqual({ conversationId: "created-1" });
		expect(gateway.created).toEqual([expect.objectContaining({ mode: ConversationModes.Direct, participantRefs: ["other-ref"], requestId: expect.any(String) })]);
		expect(store.selected()?.id).toBe("conversation-1");
	});

	it("reuses the exact creation UUID after an ambiguous gateway failure", async function _RetriesCreate()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.selectCreationMode(ConversationModes.Direct);
		store.toggleParticipant("other-ref");
		gateway.createResult = Promise.reject(new Error("response lost"));
		await expect(store.create()).resolves.toBeNull();
		gateway.createResult = null;
		await expect(store.create()).resolves.toEqual({ conversationId: "created-1" });
		expect(gateway.created).toHaveLength(2);
		expect(gateway.created[1]?.requestId).toBe(gateway.created[0]?.requestId);
	});

	it("does not navigate to a created conversation after the participant selects another row", async function _StaleCreate()
	{
		const [store, gateway] = _CreateStore();
		gateway.listResult = [_Detail(), _Detail("conversation-2")];
		await store.load();
		store.selectCreationMode(ConversationModes.Direct);
		store.toggleParticipant("other-ref");
		const deferred = _Deferred<ConversationWorkspaceDetail>();
		gateway.createResult = deferred.promise;
		const creation = store.create();
		await store.open("conversation-2");

		deferred.resolve(_Detail("created-1"));

		expect(await creation).toBeNull();
		expect(store.selected()?.id).toBe("conversation-2");
	});

	it("does not clear a newer selection when an archive completes late", async function _StaleArchive()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		gateway.listResult = [_Detail(), _Detail("conversation-2")];
		await store.load();
		const deferred = _Deferred<ConversationWorkspaceDetail>();
		gateway.archiveResult = deferred.promise;
		const archive = store.archive();
		await store.open("conversation-2");

		deferred.resolve({ ..._Detail("conversation-1"), archivedAt: "2026-08-12T10:00:00.000Z" });

		expect(await archive).toBeNull();
		expect(store.selected()?.id).toBe("conversation-2");
	});

	it("moves an archived conversation into history immediately", async function _AdoptArchive()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();

		expect(await store.archive()).toEqual({ conversationId: null });
		expect(store.conversations()).toEqual([{ ..._Detail(), archivedAt: "2026-08-12T10:00:00.000Z" }]);
		expect(store.selected()).toBeNull();
	});

	it("retains a message draft while the live stream reconnects", async function _ReconnectDraft()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		stream.status = ConversationEventStreamStatuses.Reconnecting;
		await store.load();
		store.updateDraft("Keep this draft");
		expect(store.draft()).toBe("Keep this draft");
		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.Reconnecting);
		expect(store.canSend()).toBe(false);
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Ready);
	});

	it("replaces a reconnecting socket without losing the draft or accepting its late updates", async function _ManualReconnect()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		stream.status = ConversationEventStreamStatuses.Reconnecting;
		stream.state = { ...__CreateAgUiStreamState(), messages: { "message-1": { id: "message-1", role: "assistant", text: "Keep this projection", status: AgUiMessageStatuses.Completed } } };
		await store.load();
		store.updateDraft("Keep this draft");
		const stale = stream.commands[0]!;

		stream.status = ConversationEventStreamStatuses.Connecting;
		store.reconnect();
		stale.onUpdate?.({ status: ConversationEventStreamStatuses.Failed, state: __CreateAgUiStreamState(), reconnectAttempt: 4, lastHeartbeatAt: null });

		expect(stream.starts).toBe(2);
		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.Connecting);
		expect(store.manualReconnectPending()).toBe(true);
		expect(store.reconnectAttempt()).toBe(0);
		expect(store.draft()).toBe("Keep this draft");
		expect(store.live().messages["message-1"]?.text).toBe("Keep this projection");

		store.reconnect();
		expect(stream.starts).toBe(2);
	});

	it("releases an interrupted send when manual reconnect replaces its socket", async function _ManualReconnectInterruptedSend()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.updateDraft("Retry this exact message");
		const pendingSend = _Deferred<void>();
		gateway.sendResult = pendingSend.promise;
		const sent = store.send();
		const stale = stream.commands[0]!;

		stale.onUpdate?.({ status: ConversationEventStreamStatuses.Reconnecting, state: __CreateAgUiStreamState(), reconnectAttempt: 1, lastHeartbeatAt: null });
		stream.status = ConversationEventStreamStatuses.Live;
		store.reconnect();

		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.Live);
		expect(store.manualReconnectPending()).toBe(false);
		expect(store.sending()).toBe(false);
		expect(store.canSend()).toBe(true);

		pendingSend.resolve();
		expect(await sent).toBe(false);
		expect(store.sending()).toBe(false);
		expect(store.draft()).toBe("Retry this exact message");

		store.updateDraft("Write a different message");
		expect(await store.send()).toBe(true);
		expect(gateway.sent[1]?.blocks).toEqual([{ id: "command-key", kind: MessageContentBlockKinds.Text, value: "Write a different message" }]);
		expect(store.draft()).toBe("");
	});

	it("uses the changed attachment selection after manual reconnect replaces an interrupted send", async function _ManualReconnectChangedAttachment()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		const pendingSend = _Deferred<void>();
		gateway.sendResult = pendingSend.promise;
		const sent = store.send(["asset-a"]);
		const stale = stream.commands[0]!;

		stale.onUpdate?.({ status: ConversationEventStreamStatuses.Reconnecting, state: __CreateAgUiStreamState(), reconnectAttempt: 1, lastHeartbeatAt: null });
		stream.status = ConversationEventStreamStatuses.Live;
		store.reconnect();
		pendingSend.resolve();
		expect(await sent).toBe(false);

		expect(await store.send(["asset-b"])).toBe(true);
		expect(gateway.sent[1]?.blocks).toEqual([{ id: "command-key", kind: MessageContentBlockKinds.Artifact, value: "asset-b" }]);
	});

	it("ignores stale run coordinates for a direct conversation", async function _IgnoreDirectRun()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		gateway.listResult = [{ ..._Detail(), mode: ConversationModes.Direct }];
		stream.state = { ...__CreateAgUiStreamState(), runId: "stale-run" };

		await store.load();
		await Promise.resolve();

		expect(gateway.runReads).toBe(0);
		expect(store.runs.run()).toBeNull();
	});

	it("admits run coordinates only for an Agent session", async function _AdmitAgentRun()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		gateway.listResult = [{ ..._Detail(), mode: ConversationModes.AgentSession, agentServiceId: "agent-1", participantRefs: ["self-ref"] }];
		stream.state = { ...__CreateAgUiStreamState(), runId: "run-1" };

		await store.load();
		await vi.waitFor(function _RunLoaded() { expect(gateway.runReads).toBe(1); });

		expect(store.runs.run()?.runId).toBe("run-1");
	});

	it("reuses the exact message command after an ambiguous response", async function _RetryExactMessage()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.updateDraft("Send once");
		gateway.sendError = new Error("connection reset after commit");

		expect(await store.send()).toBe(false);
		gateway.sendError = null;
		expect(await store.send()).toBe(true);

		expect(gateway.sent).toHaveLength(2);
		expect(gateway.sent[1]).toEqual(gateway.sent[0]);
		expect(store.draft()).toBe("");
	});

	it("submits an attachment-only message using a durable asset reference", async function _AttachmentOnly()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();

		expect(await store.send(["asset-1"])).toBe(true);

		expect(gateway.sent[0]?.blocks).toEqual([{ id: "command-key", kind: MessageContentBlockKinds.Artifact, value: "asset-1" }]);
	});

	it("disables the composer after the socket proves a selected conversation closed", async function _ClosedConversation()
	{
		const [store, gateway] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.updateDraft("Send once");
		gateway.sendError = new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.Conflict, "This conversation is closed and cannot accept messages.");

		expect(await store.send()).toBe(false);
		expect(store.selected()?.lifecycle).toBe(ConversationLifecycles.Closed);
		expect(store.canSend()).toBe(false);
	});

	it("purges a selected conversation and draft when its socket proves access loss", async function _AccessLoss()
	{
		const [store, gateway, stream] = _CreateStore();
		gateway.historyResult = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null };
		await store.load();
		store.updateDraft("Private draft");
		stream.state = { ...__CreateAgUiStreamState(), accessRevoked: true };
		await store.open("conversation-1");
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged);
		expect(store.selected()).toBeNull();
		expect(store.draft()).toBe("");
		expect(store.live().accessRevoked).toBe(false);
	});
});
