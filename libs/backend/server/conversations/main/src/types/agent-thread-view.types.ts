import { ConversationLifecycles, MessageRoles, MessageSources, MessageStates, type MessageContentBlock } from "@opencrane/models/conversations";
import type { AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";

/** One serial governed run included in the bounded Agent-thread read model. */
export enum AgentThreadRunViewStates
{
	Queued = "queued",
	Working = "working",
	Waiting = "waiting",
	Retrying = "retrying",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}

/** One serial governed run included in the bounded Agent-thread read model. */
export interface AgentThreadRunView
{
	readonly id: string;
	readonly ordinal: number;
	readonly attempt: number;
	readonly state: AgentThreadRunViewStates;
	readonly acceptedAt: string;
	readonly finishedAt: string | null;
}

/** Participant-visible child message without login identifiers or nested thread authority. */
export interface AgentThreadMessageView
{
	readonly id: string;
	readonly position: string;
	readonly role: MessageRoles;
	readonly state: MessageStates;
	readonly source: MessageSources;
	readonly blocks: readonly MessageContentBlock[];
	readonly runId: string | null;
	readonly createdAt: string;
	readonly completedAt: string | null;
}

/** Canonical authorized child read model without participant login identifiers. */
export interface AgentThreadSnapshotView
{
	readonly parentConversationId: string;
	readonly childConversationId: string;
	readonly rootConversationId: string;
	readonly parentMessageId: string;
	readonly agentServiceId: string;
	readonly agentName: string;
	readonly ask: string;
	readonly createdAt: string;
	readonly lifecycle: ConversationLifecycles;
	readonly participantCount: number;
	readonly readThroughPosition: string;
	readonly latestPosition: string;
	readonly representedThroughPosition: string;
	readonly messageCount: number;
	/** Exact canonical message count after this participant's read coordinate. */
	readonly unreadMessageCount: number;
	/** Resume cursor for representedThroughPosition; never skips an omitted event. */
	readonly cursor: string | null;
	readonly messages: readonly AgentThreadMessageView[];
	readonly runs: readonly AgentThreadRunView[];
	readonly deliveries: readonly AgentThreadParentDelivery[];
}
