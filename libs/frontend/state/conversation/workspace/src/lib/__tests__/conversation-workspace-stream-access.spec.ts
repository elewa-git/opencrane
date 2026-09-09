import { DestroyRef, Injector } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes, MessageRoles } from "@opencrane/models/conversations";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors";
import { ConversationOnboardingHistoryStore } from "../conversation-onboarding-history.store";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationCreationStates, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates } from "../conversation-workspace.types";

/** Builds a store with a controllable event stream and the existing list/directory ports. */
function _Workspace()
{
	const commands: StreamConversationEventsCommand[] = [];
	const detail = { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: [], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z" };
	const gateway = {
		open: vi.fn().mockImplementation(async function _Open(id: string) { return { ...detail, id, visibleFromPosition: "0", accessEndedPosition: null, parent: null }; }),
		send: vi.fn().mockResolvedValue(undefined),
		create: vi.fn(),
		archive: vi.fn(),
		close: vi.fn(),
		directory: vi.fn().mockResolvedValue({ companyAssistants: [], participants: [{ participantRef: "member-2", isSelf: false, label: "Sam" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Assistant" } }),
		list: vi.fn().mockResolvedValue([detail, { ...detail, id: "conversation-2" }]),
		onboardingHistory: vi.fn().mockResolvedValue({ status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null })
	};
	const stream = { stream: vi.fn().mockImplementation(function _Connect(command: StreamConversationEventsCommand)
	{
		commands.push(command);
		return new Promise(function _Pending() { /* The test controls delivery until selection aborts. */ });
	}) };
	const injector = Injector.create({ providers: [ConversationWorkspaceStore, ConversationOnboardingHistoryStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }] });
	return { store: injector.get(ConversationWorkspaceStore), commands, gateway };
}

/** Publishes an accepted private projection through the same observer used by the real adapter. */
function _Live(command: StreamConversationEventsCommand): void
{
	command.onUpdate?.({ status: ConversationEventStreamStatuses.Live, state: { ...__CreateConversationHistoryProjection(), payloads: { "payload-private": "Private message" }, nextPosition: "2" }, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
}

describe("conversation stream access changes", function _DescribeAccess()
{
	it("opens a new child absent from the list using its authoritative origin and visibility", async function _ChildDeepLink()
	{
		const { store, gateway } = _Workspace();
		await store.load();
		gateway.open.mockResolvedValueOnce({ id: "new-child", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "company", participantRefs: [], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-07T00:00:00.000Z", visibleFromPosition: "7", accessEndedPosition: null, parent: { requestId: "request", parentConversationId: "group", parentMessageId: "message", parentMessagePosition: "3" } });
		await store.open("new-child");
		expect(gateway.open).toHaveBeenLastCalledWith("new-child");
		expect(store.selected()).toMatchObject({ id: "new-child", visibleFromPosition: "7", parent: { parentConversationId: "group" } });
		expect(store.conversations().some(item => item.id === "new-child")).toBe(true);
	});

	it("does not restore a late metadata read after another selection was denied", async function _LateMetadata()
	{
		const { store, gateway } = _Workspace();
		await store.load();
		const detail = store.selected()!;
		let finish!: (value: typeof detail) => void;
		gateway.open.mockImplementationOnce(function _Pending() { return new Promise(function _Wait(resolve) { finish = resolve; }); });
		const pending = store.open("late-child");
		gateway.open.mockRejectedValueOnce(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "unavailable"));
		await store.open("revoked-child");
		finish({ ...detail, id: "late-child" });
		await pending;
		expect(store.selected()).toBeNull();
		expect(store.conversations().some(item => item.id === "late-child")).toBe(false);
		expect(store.live()).toEqual(__CreateConversationHistoryProjection());
	});

	it("purges the selected history and draft, then rejects late updates from the revoked stream", async function _PurgeRevoked()
	{
		const { store, commands, gateway } = _Workspace();
		let finish: () => void = function _Unassigned() { throw new Error("send not started"); };
		gateway.send.mockImplementationOnce(function _Pending() { return new Promise<void>(function _Wait(resolve) { finish = resolve; }); });
		await store.load();
		const command = commands[0]!;
		store.history.adopt({ status: ConversationOnboardingHistoryStatuses.Ready, history: { id: "onboarding", personaDisplayName: "Private assistant", startedAt: "2026-09-05T00:00:00Z", completedAt: "2026-09-05T00:01:00Z", transcript: [{ ordinal: 1, role: MessageRoles.User, text: "Private introduction" }] } });
		store.selectCreationMode(ConversationModes.Group);
		store.toggleParticipant("member-2");
		_Live(command);
		store.updateDraft("Private draft");
		const sending = store.send();
		expect(store.sending()).toBe(true);
		command.onUpdate?.({ status: ConversationEventStreamStatuses.AccessChanged, state: __CreateConversationHistoryProjection(), reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		expect(command.signal.aborted).toBe(true);
		expect(store.selected()).toBeNull();
		expect(store.directory()).toBeNull();
		expect(store.conversations()).toEqual([]);
		expect(store.onboardingHistory()).toEqual({ status: ConversationOnboardingHistoryStatuses.Unavailable, history: null });
		expect(store.onboardingHistorySelected()).toBe(false);
		expect(store.selectedParticipantRefs().size).toBe(0);
		expect(store.creationState()).toBe(ConversationCreationStates.Idle);
		expect(store.canCreate()).toBe(false);
		expect(store.live()).toEqual(__CreateConversationHistoryProjection());
		expect(store.draft()).toBe("");
		expect(store.canSend()).toBe(false);
		expect(store.sending()).toBe(false);
		expect(store.streamStatus()).toBe(ConversationEventStreamStatuses.AccessChanged);
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged);
		_Live(command);
		expect(store.live()).toEqual(__CreateConversationHistoryProjection());
		finish();
		await expect(sending).resolves.toBe(false);
	});

	it("does not let a prior selection revoke the newly selected conversation", async function _StaleRevocation()
	{
		const { store, commands } = _Workspace();
		await store.load();
		const previous = commands[0]!;
		await store.open("conversation-2");
		_Live(commands[1]!);
		store.updateDraft("New selection draft");
		previous.onUpdate?.({ status: ConversationEventStreamStatuses.AccessChanged, state: __CreateConversationHistoryProjection(), reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		expect(previous.signal.aborted).toBe(true);
		expect(store.selected()?.id).toBe("conversation-2");
		expect(store.draft()).toBe("New selection draft");
	});

	it.each(["success", "failure"])("rejects a late create %s after access loss", async function _LateCreate(outcome)
	{
		const { store, gateway, commands } = _Workspace();
		await store.load();
		const detail = store.selected()!;
		const deferred = _Deferred<typeof detail>();
		gateway.create.mockReturnValueOnce(deferred.promise);
		const pending = store.create();
		expect(store.creationState()).toBe(ConversationCreationStates.Creating);
		_Revoke(commands[0]!);
		if (outcome === "success")
			deferred.resolve({ ...detail, id: "late-created" });
		else deferred.reject(new Error("late failure"));
		await expect(pending).resolves.toBeNull();
		expect(store.conversations()).toEqual([]);
		expect(store.directory()).toBeNull();
		expect(store.creationState()).toBe(ConversationCreationStates.Idle);
		expect(store.error()).toBeNull();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged);
	});

	it("keeps one pending creation across a selection change and adopts its list row without navigating", async function _CreateAcrossSelection()
	{
		const { store, gateway } = _Workspace();
		await store.load();
		const detail = store.selected()!;
		const deferred = _Deferred<typeof detail>();
		gateway.create.mockReturnValueOnce(deferred.promise);
		const pending = store.create();
		await store.open("conversation-2");
		expect(store.creationState()).toBe(ConversationCreationStates.Creating);
		await expect(store.create()).resolves.toBeNull();
		expect(gateway.create).toHaveBeenCalledTimes(1);
		deferred.resolve({ ...detail, id: "created" });
		await expect(pending).resolves.toBeNull();
		expect(store.selected()?.id).toBe("conversation-2");
		expect(store.conversations().map(item => item.id)).toContain("created");
		expect(store.creationState()).toBe(ConversationCreationStates.Idle);
	});

	it("rejects a late archive after access loss", async function _LateArchive()
	{
		const { store, gateway, commands } = _Workspace();
		await store.load();
		const detail = store.selected()!;
		const deferred = _Deferred<typeof detail>();
		gateway.archive.mockReturnValueOnce(deferred.promise);
		const pending = store.archive();
		_Revoke(commands[0]!);
		deferred.resolve({ ...detail, archivedAt: "2026-09-09T02:00:00Z" });
		await expect(pending).resolves.toBeNull();
		expect(store.conversations()).toEqual([]);
		expect(store.selected()).toBeNull();
		expect(store.conversationCommandBusy()).toBe(false);
	});

	it.each(["reconnect", "load"])("releases an interrupted archive on %s without letting its completion release a newer command", async function _InterruptedArchive(action)
	{
		const { store, gateway, commands } = _Workspace();
		await store.load();
		const detail = store.selected()!;
		const oldCommand = _Deferred<typeof detail>();
		gateway.archive.mockReturnValueOnce(oldCommand.promise);
		const pendingArchive = store.archive();
		expect(store.conversationCommandBusy()).toBe(true);
		if (action === "reconnect")
		{
			commands[0]!.onUpdate?.({ status: ConversationEventStreamStatuses.Failed, state: __CreateConversationHistoryProjection(), reconnectAttempt: 1, lastHeartbeatAt: null });
			store.reconnect();
		}
		else await store.load();
		expect(store.conversationCommandBusy()).toBe(false);
		const newCommand = _Deferred<typeof detail>();
		gateway.close.mockReturnValueOnce(newCommand.promise);
		const pendingClose = store.close();
		expect(store.conversationCommandBusy()).toBe(true);
		oldCommand.resolve({ ...detail, archivedAt: "2026-09-09T02:00:00Z" });
		await expect(pendingArchive).resolves.toBeNull();
		expect(store.conversationCommandBusy()).toBe(true);
		expect(store.conversations().find(item => item.id === detail.id)?.archivedAt).toBeNull();
		newCommand.resolve({ ...detail, lifecycle: ConversationLifecycles.Closed });
		await pendingClose;
		expect(store.conversationCommandBusy()).toBe(false);
		expect(store.selected()?.lifecycle).toBe(ConversationLifecycles.Closed);
	});

	it.each(["directory", "list", "onboardingHistory"] as const)("purges prior workspace data when %s proves access loss during reload", async function _DeniedReload(port)
	{
		const { store, gateway, commands } = _Workspace();
		await store.load();
		_Live(commands[0]!);
		store.updateDraft("Private draft");
		gateway[port].mockRejectedValueOnce(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "unavailable"));
		await store.load();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged);
		expect(store.directory()).toBeNull();
		expect(store.conversations()).toEqual([]);
		expect(store.selected()).toBeNull();
		expect(store.draft()).toBe("");
		expect(store.live()).toEqual(__CreateConversationHistoryProjection());
		expect(commands[0]!.signal.aborted).toBe(true);
	});

	it.each(["list", "onboardingHistory"] as const)("purges a later %s denial even after a temporary directory failure completed the load", async function _LateDeniedRead(port)
	{
		const { store, gateway, commands } = _Workspace();
		await store.load();
		_Live(commands[0]!);
		store.updateDraft("Private retained draft");
		const denied = _Deferred<never>();
		gateway.directory.mockRejectedValueOnce(new Error("temporary directory outage"));
		gateway[port].mockReturnValueOnce(denied.promise);
		await store.load();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Unavailable);
		denied.reject(new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "unavailable"));
		await vi.waitFor(function _Purged() { expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.AccessChanged); });
		expect(store.directory()).toBeNull();
		expect(store.conversations()).toEqual([]);
		expect(store.selected()).toBeNull();
		expect(store.draft()).toBe("");
		expect(store.live()).toEqual(__CreateConversationHistoryProjection());
	});

	it("keeps ordinary conversations available when only optional onboarding history has a temporary failure", async function _OptionalHistoryFailure()
	{
		const { store, gateway } = _Workspace();
		gateway.onboardingHistory.mockRejectedValueOnce(new Error("temporary failure"));
		await store.load();
		expect(store.routeState()).toBe(ConversationWorkspaceRouteStates.Ready);
		expect(store.selected()?.id).toBe("conversation-1");
		expect(store.onboardingHistory()).toEqual({ status: ConversationOnboardingHistoryStatuses.Unavailable, history: null });
	});
});


/** Delivers the authority-loss event used by a revoked live subscription. */
function _Revoke(command: StreamConversationEventsCommand): void
{
	command.onUpdate?.({ status: ConversationEventStreamStatuses.AccessChanged, state: __CreateConversationHistoryProjection(), reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
}

/** Holds an asynchronous result so each test can order it against navigation and access loss. */
function _Deferred<T>()
{
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>(function _Wait(onResolve, onReject) { resolve = onResolve; reject = onReject; });
	return { promise, resolve, reject };
}
