import { AgentThreadAccessStates, AgentThreadDeliveryKinds, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadTimelineEntryKinds } from "./agent-thread-state.types.js";

export { AgentThreadAccessStates, AgentThreadAdmissionStates, AgentThreadDeliveryKinds, AgentThreadRecoveryStates, AgentThreadRouteStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadTimelineEntryKinds } from "./agent-thread-state.types.js";

/** Exact typed intent for one authorized parent mention. */
export interface AgentThreadCreateIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Root `@agent` message coordinate used for idempotent creation. */
	readonly parentMessageId: string;
}

/** Exact navigation intent that restores the originating parent location. */
export interface AgentThreadParentRestoreIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Exact root message that should regain focus. */
	readonly parentMessageId: string;
	/** Opaque parent scroll anchor captured by the route coordinator. */
	readonly parentScrollAnchor: string;
}

/** Display-safe author and copy for one child message. */
export interface AgentThreadMessagePresentation
{
	/** Stable message coordinate. */
	readonly id: string;
	/** Display-safe author name. */
	readonly authorName: string;
	/** Display-safe author initials. */
	readonly authorInitials: string;
	/** Whether this message was emitted by the governed Agent. */
	readonly authoredByAgent: boolean;
	/** Preformatted time label. */
	readonly timestampLabel: string;
	/** Plain display-safe message copy. */
	readonly body: string;
}

/** Immutable origin shown at the top of a child conversation. */
export interface AgentThreadOriginPresentation
{
	/** Parent group title. */
	readonly parentTitle: string;
	/** Root `@agent` message coordinate. */
	readonly parentMessageId: string;
	/** Display-safe invoking participant name. */
	readonly invokedByName: string;
	/** Display-safe invoking participant initials. */
	readonly invokedByInitials: string;
	/** Exact display-safe root message copy. */
	readonly ask: string;
	/** Preformatted creation time label. */
	readonly timestampLabel: string;
}

/** One visible boundary between serial runs in the same child conversation. */
export interface AgentThreadRunBoundaryPresentation
{
	/** Stable run coordinate. */
	readonly runId: string;
	/** One-based serial position within this child. */
	readonly ordinal: number;
	/** Independent lifecycle state. */
	readonly state: AgentThreadRunStates;
	/** Display-safe short label. */
	readonly label: string;
	/** Optional browser-safe explanation. */
	readonly detail?: string;
}

/** One append-only delivery to the immediate parent. */
export interface AgentThreadDeliveryPresentation
{
	/** Stable delivery coordinate for idempotent rendering. */
	readonly id: string;
	/** Delivery category. */
	readonly kind: AgentThreadDeliveryKinds;
	/** Display-safe short label. */
	readonly label: string;
	/** Display-safe summary without raw provider or authority data. */
	readonly detail: string;
	/** Preformatted delivery time. */
	readonly timestampLabel: string;
	/** Optional stable rich-card coordinate resolved by its owning renderer. */
	readonly richCardId?: string;
}

/** Compact authorized child state rendered beneath the root parent message. */
export interface AgentThreadSummaryPresentation
{
	/** Child conversation coordinate used by route navigation. */
	readonly childConversationId: string;
	/** Derived summary state. */
	readonly state: AgentThreadSummaryStates;
	/** Independent access state. */
	readonly access: AgentThreadAccessStates;
	/** Display-safe child title. */
	readonly title: string;
	/** Latest authorized preview; absent when access is restricted. */
	readonly preview?: string;
	/** Count of unread child messages for this participant. */
	readonly unreadCount: number;
	/** Display-safe participant initials. */
	readonly participantInitials: readonly string[];
	/** Number of replies after the root message. */
	readonly replyCount: number;
}

/** One ordered child timeline entry with exactly one presentation payload. */
export type AgentThreadTimelineEntry =
	| { readonly kind: AgentThreadTimelineEntryKinds.RunBoundary; readonly id: string; readonly run: AgentThreadRunBoundaryPresentation }
	| { readonly kind: AgentThreadTimelineEntryKinds.Message; readonly id: string; readonly message: AgentThreadMessagePresentation }
	| { readonly kind: AgentThreadTimelineEntryKinds.Delivery; readonly id: string; readonly delivery: AgentThreadDeliveryPresentation };

/** Full authorized child view adopted atomically by the browser store. */
export interface AgentThreadSnapshot
{
	/** Exact parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Exact child conversation coordinate. */
	readonly childConversationId: string;
	/** Immutable root-message origin. */
	readonly origin: AgentThreadOriginPresentation;
	/** Compact parent summary. */
	readonly summary: AgentThreadSummaryPresentation;
	/** Independent delivery recovery state. */
	readonly recovery: AgentThreadRecoveryStates;
	/** One exact ordered timeline across messages, serial run boundaries, and deliveries. */
	readonly timeline: readonly AgentThreadTimelineEntry[];
	/** Opaque cursor accepted only by the gateway implementation. */
	readonly cursor: string | null;
	/** Whether the current state permits another serial follow-up. */
	readonly canSendFollowUp: boolean;
}

/** Dependency-neutral browser port; a generated-client adapter is added after OpenAPI exists. */
export interface AgentThreadGateway
{
	/** Read one exact authorized child projection. */
	read(parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshot>;
	/** Send one serial follow-up using a caller-created idempotency fence. */
	sendFollowUp(parentConversationId: string, childConversationId: string, body: string, idempotencyKey: string): Promise<AgentThreadSnapshot>;
}
