import { DestroyRef, Injector } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds } from "../conversation-workspace-gateway.errors";
import { ConversationOnboardingHistoryStore } from "../conversation-onboarding-history.store";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceRouteStates } from "../conversation-workspace.types";

/** Builds a store with a controllable event stream and the existing list/directory ports. */
function _Workspace()
{
	const commands: StreamConversationEventsCommand[] = [];
	const detail = { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: [], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z" };
	const gateway = {
		open: vi.fn().mockImplementation(async function _Open(id: string) { return { ...detail, id, visibleFromPosition: "0", accessEndedPosition: null, parent: null }; }),
		send: vi.fn().mockResolvedValue(undefined),
		directory: vi.fn().mockResolvedValue({ companyAssistants: [], participants: [], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Assistant" } }),
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
		_Live(command);
		store.updateDraft("Private draft");
		const sending = store.send();
		expect(store.sending()).toBe(true);
		command.onUpdate?.({ status: ConversationEventStreamStatuses.AccessChanged, state: __CreateConversationHistoryProjection(), reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		expect(command.signal.aborted).toBe(true);
		expect(store.selected()).toBeNull();
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
});
