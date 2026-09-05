import { DestroyRef, Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";

import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY } from "../conversation-workspace.gateway";
import { ConversationOnboardingHistoryStore } from "../conversation-onboarding-history.store";
import { ConversationWorkspaceStore } from "../conversation-workspace.store";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "../conversation-workspace.types";

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
	public async create() { return _Detail(); }
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
