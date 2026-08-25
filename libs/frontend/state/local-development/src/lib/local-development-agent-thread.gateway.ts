import { Injectable, inject } from "@angular/core";

import { AgentThreadGatewayError, AgentThreadGatewayErrorKinds, AgentThreadTimelineEntryKinds, type AgentThreadGateway, type AgentThreadSnapshot } from "@opencrane/state/conversation/agent-threads";

import { __CreateLocalAgentThread, __LocalAgentThreadKey } from "./local-development-agent-thread.fixture";
import { LocalDevelopmentScenarioKinds } from "./local-development-scenario.types";
import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements child Agent-thread reads and commands against shared Tier 1 state. It retains
 * follow-ups and read markers so navigating away and back exercises the same route lifecycle.
 */
@Injectable()
export class LocalDevelopmentAgentThreadGateway implements AgentThreadGateway
{
	/** Shared scenario state and retained thread projections. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Read the child projection, creating its fixture on the first visit. */
	public async read(parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshot>
	{
		await this._state.delay();

		if (this._state.scenario === LocalDevelopmentScenarioKinds.AccessChanged)
		{
			throw new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.AccessChanged, "The Agent thread is no longer available.");
		}

		const key = __LocalAgentThreadKey(parentConversationId, childConversationId);
		const current = this._state.agentThreads.get(key) ?? __CreateLocalAgentThread(parentConversationId, childConversationId, this._state.fixture.displayName);
		this._state.agentThreads.set(key, current);
		return current;
	}

	/** Append a follow-up message and retain the resulting projection. */
	public async sendFollowUp(parentConversationId: string, childConversationId: string, body: string, _idempotencyKey: string): Promise<AgentThreadSnapshot>
	{
		this._state.failOnce("agent-thread-follow-up");
		const current = await this.read(parentConversationId, childConversationId);
		const messageId = this._state.nextId("thread-message");
		const changed: AgentThreadSnapshot = {
			...current,
			timeline: [...current.timeline, { kind: AgentThreadTimelineEntryKinds.Message, id: messageId, message: { id: messageId, authorName: "You", authorInitials: "Y", authoredByAgent: false, timestampLabel: "now", body } }],
			latestPosition: "4",
			representedThroughPosition: "4",
			visibleThroughPosition: "4"
		};
		this._state.agentThreads.set(__LocalAgentThreadKey(parentConversationId, childConversationId), changed);
		return changed;
	}

	/** Clear unread state only through a position the route has already displayed. */
	public async markReadThrough(parentConversationId: string, childConversationId: string, observedPosition: string): Promise<void>
	{
		const current = await this.read(parentConversationId, childConversationId);

		if (BigInt(observedPosition) > BigInt(current.visibleThroughPosition))
		{
			throw new AgentThreadGatewayError(AgentThreadGatewayErrorKinds.Conflict, "The Agent thread has not displayed that position.");
		}

		const changed = { ...current, summary: { ...current.summary, unreadCount: 0 } };
		this._state.agentThreads.set(__LocalAgentThreadKey(parentConversationId, childConversationId), changed);
	}
}
