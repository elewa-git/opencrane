import { DestroyRef, Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationOnboardingHistoryStore } from "../conversation-onboarding-history.store";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationCreationStates, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway, type CreateConversationCommand } from "../conversation-workspace.types";

/** Build one metadata-only Agent conversation; history arrives through the separate poller. */
function _Detail(): ConversationWorkspaceDetail
{
	return { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: ["participant-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T00:00:00.000Z", visibleFromPosition: "0", accessEndedPosition: null };
}

/** Minimal generated API port for one selected conversation. */
class _Gateway implements ConversationWorkspaceGateway
{
	/** Captures the exact Kurrent message command sent by the store. */
	public readonly send = vi.fn().mockResolvedValue(undefined);
	/** Return one privacy-safe creation directory. */
	public async directory() { return { participants: [{ participantRef: "participant-1", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Agent" } }; }
	/** Return one selectable conversation metadata row. */
	public async list() { return [_Detail()]; }
	/** Report that no separate onboarding transcript exists. */
	public async onboardingHistory() { return { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null } as const; }
	/** Return metadata only; messages come from Kurrent history. */
	public async open() { return _Detail(); }
	/** Return the created metadata row. */
	public readonly create = vi.fn<(command: CreateConversationCommand) => Promise<ConversationWorkspaceDetail>>().mockResolvedValue(_Detail());
	/** Return an updated archive projection. */
	public async archive() { return { ..._Detail(), archivedAt: "2026-09-05T00:01:00.000Z" }; }
	/** Return a closed metadata projection. */
	public async close() { return { ..._Detail(), lifecycle: ConversationLifecycles.Closed }; }
}

/** Poller test double that immediately reports caught-up Kurrent history. */
class _HistoryStream implements ConversationEventStream
{
	/** Publish one live update and stop when selection changes. */
	public async stream(command: StreamConversationEventsCommand)
	{
		const state = __CreateConversationHistoryProjection();
		command.onUpdate?.({ status: ConversationEventStreamStatuses.Live, state, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		return state;
	}
}

describe("ConversationWorkspaceStore", function _DescribeWorkspace()
{
	it("retries the same creation command after a lost response and starts a new command after success", async function _RetryCreation()
	{
		const gateway = new _Gateway();
		const injector = Injector.create({ providers: [ConversationOnboardingHistoryStore, ConversationWorkspaceStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: _HistoryStream }] });
		const store = injector.get(ConversationWorkspaceStore);
		await store.load();
		await store.close();
		expect(store.selected()?.lifecycle).toBe(ConversationLifecycles.Closed);
		gateway.create.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ..._Detail(), id: "new-session-1" }).mockResolvedValueOnce({ ..._Detail(), id: "new-session-2" });

		await expect(store.create()).resolves.toBeNull();
		const command = gateway.create.mock.calls[0]![0];
		expect(command).toMatchObject({ mode: ConversationModes.AgentSession, personalAgentRef: "agent-1", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
		expect(store.creationState()).toBe(ConversationCreationStates.Failed);
		expect(store.canCreate()).toBe(true);
		await expect(store.create()).resolves.toEqual({ conversationId: "new-session-1" });
		expect(gateway.create.mock.calls[1]![0]).toBe(command);
		await expect(store.create()).resolves.toEqual({ conversationId: "new-session-2" });
		expect(gateway.create.mock.calls[2]![0].idempotencyKey).not.toBe(command.idempotencyKey);
		expect(store.conversations().map(item => item.id)).toContain("new-session-1");
		expect(store.conversations().map(item => item.id)).toContain("new-session-2");
	});

	it("keeps the pending choice stable and rejects a second create while the first response is outstanding", async function _PendingCreation()
	{
		const gateway = new _Gateway();
		let reject: (error: Error) => void = function _Unset() { throw new Error("create has not started"); };
		gateway.create.mockImplementationOnce(function _Pending() { return new Promise(function _Wait(_resolve, rejectCreate) { reject = rejectCreate; }); });
		const injector = Injector.create({ providers: [ConversationOnboardingHistoryStore, ConversationWorkspaceStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: _HistoryStream }] });
		const store = injector.get(ConversationWorkspaceStore);
		await store.load();
		const pending = store.create();
		store.selectCreationMode(ConversationModes.Group);
		expect(store.creationMode()).toBe(ConversationModes.AgentSession);
		await expect(store.create()).resolves.toBeNull();
		expect(gateway.create).toHaveBeenCalledTimes(1);
		reject(new Error("response lost"));
		await pending;
		await store.create();
		expect(gateway.create.mock.calls[1]![0]).toBe(gateway.create.mock.calls[0]![0]);
	});

	it.each([ConversationModes.Direct, ConversationModes.Group] as const)("retains the %s command for retry and changes its UUID for a different member set", async function _OrdinaryCreation(mode)
	{
		const gateway = new _Gateway();
		vi.spyOn(gateway, "directory").mockResolvedValue({ participants: [{ participantRef: "participant-1", isSelf: true, label: "You" }, { participantRef: "participant-2", isSelf: false, label: "Amina" }, { participantRef: "participant-3", isSelf: false, label: "Kamau" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Agent" } });
		const injector = Injector.create({ providers: [ConversationOnboardingHistoryStore, ConversationWorkspaceStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: _HistoryStream }] });
		const store = injector.get(ConversationWorkspaceStore);
		await store.load();
		store.selectCreationMode(mode);
		store.toggleParticipant("participant-2");
		gateway.create.mockRejectedValueOnce(new Error("lost response")).mockRejectedValueOnce(new Error("still unavailable"));
		await store.create();
		const first = gateway.create.mock.calls[0]![0];
		expect(first).toMatchObject({ mode, participantRefs: ["participant-2"], idempotencyKey: expect.any(String) });
		await store.create();
		expect(gateway.create.mock.calls[1]![0]).toBe(first);
		store.toggleParticipant("participant-2");
		store.toggleParticipant("participant-3");
		await store.create();
		expect(gateway.create.mock.calls[2]![0]).toMatchObject({ participantRefs: ["participant-3"] });
		expect(gateway.create.mock.calls[2]![0].idempotencyKey).not.toBe(first.idempotencyKey);
		await store.create();
		expect(gateway.create.mock.calls[3]![0].idempotencyKey).not.toBe(gateway.create.mock.calls[2]![0].idempotencyKey);
	});

	it("sends an Agent-session message through HTTP with start activation", async function _SendsKurrentMessage()
	{
		const gateway = new _Gateway();
		const injector = Injector.create({ providers: [ConversationOnboardingHistoryStore, ConversationWorkspaceStore, { provide: DestroyRef, useValue: { onDestroy: vi.fn() } }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useClass: _HistoryStream }] });
		const store = runInInjectionContext(injector, function _Store() { return injector.get(ConversationWorkspaceStore); });
		await store.load();
		store.updateDraft("Hello agent");
		await expect(store.send()).resolves.toBe(true);
		expect(gateway.send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conversation-1", text: "Hello agent", activation: "start" }));
	});
});
