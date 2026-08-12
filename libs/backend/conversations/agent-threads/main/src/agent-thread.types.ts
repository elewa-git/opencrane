import type { AgentThreadDeliveryKinds } from "@opencrane/contracts";

/** Stable public projection event names for Agent-thread parent communication. */
export enum AgentThreadEventTypes
{
	ParentDelivery = "conversation.agent_thread.parent_delivery",
}

/** Parent-summary states derived from durable child and latest-run facts. */
export enum AgentThreadSummaryStates
{
	/** The first run is queued or accepted but has not begun execution. */
	Starting = "starting",
	/** The current foreground run is executing. */
	Working = "working",
	/** The current run waits for participant input or approval. */
	Waiting = "waiting",
	/** A failed attempt remains eligible for a visible retry. */
	Retrying = "retrying",
	/** The latest run completed. */
	Completed = "completed",
	/** The latest run failed. */
	Failed = "failed",
	/** The latest run was cancelled. */
	Cancelled = "cancelled",
	/** The child conversation is closed. */
	Closed = "closed",
}

/** Exact Agent target carried by a participant-authored group message. */
export interface AgentThreadTarget
{
	/** Active personal AgentService selected for this invocation. */
	readonly agentServiceId: string;
}

/** Immutable origin fixed when a group mention creates its child Agent thread. */
export interface AgentThreadOrigin
{
	/** Child agent-session conversation. */
	readonly childConversationId: string;
	/** Immediate parent group conversation. */
	readonly parentConversationId: string;
	/** Root conversation for breadcrumb navigation. */
	readonly rootConversationId: string;
	/** Ordinary participant message that invoked the Agent. */
	readonly parentMessageId: string;
	/** Participant whose approved persona is fixed into the first run. */
	readonly initiatorUserId: string;
	/** Exact personal AgentService used by all runs in the child. */
	readonly agentServiceId: string;
	/** Approved persona revision frozen during first-run admission. */
	readonly personaRevisionId: string;
	/** First admitted run. */
	readonly firstRunId: string;
}

/** Display-safe append-only delivery to one immediate parent. */
export interface AgentThreadParentDelivery
{
	/** Stable delivery identity and idempotency coordinate. */
	readonly id: string;
	/** Child conversation that authored the delivery. */
	readonly childConversationId: string;
	/** Immediate parent that receives the delivery. */
	readonly parentConversationId: string;
	/** Run responsible for the delivery. */
	readonly runId: string;
	/** Safe delivery category. */
	readonly kind: AgentThreadDeliveryKinds;
	/** Short display label. */
	readonly label: string;
	/** Sanitized summary without provider bodies, secrets, proofs or raw tool arguments. */
	readonly detail: string;
	/** Optional released asset coordinate. */
	readonly assetId: string | null;
	/** Canonical append time. */
	readonly createdAt: string;
}

/** Bounded child summary shown below the originating parent message. */
export interface AgentThreadSummary
{
	/** Child conversation opened by the summary. */
	readonly childConversationId: string;
	/** Parent message below which this summary belongs. */
	readonly parentMessageId: string;
	/** Latest durable lifecycle state. */
	readonly state: AgentThreadSummaryStates;
	/** Number of child timeline entries after the root ask. */
	readonly updateCount: number;
	/** Number of entries beyond this participant's read coordinate. */
	readonly unreadCount: number;
	/** Bounded latest safe delivery preview. */
	readonly preview: string | null;
	/** Canonical latest activity time. */
	readonly updatedAt: string;
}

/** Result of checking a structured target against a persisted parent conversation. */
export type AgentThreadTargetDecision = { readonly allowed: true } | { readonly allowed: false };
