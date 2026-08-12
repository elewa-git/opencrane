/** The route-level state machine for an Agent-thread page. */
export enum AgentThreadRouteStates
{
	/** No authoritative snapshot has completed loading. */
	Loading = "loading",
	/** An authorized snapshot is available to render. */
	Ready = "ready",
	/** The route is absent, foreign, or not authorized; these cases are intentionally identical. */
	Unavailable = "unavailable",
	/** A previously authorized view observed access loss and purged its local child state. */
	AccessChanged = "access_changed"
}

/** Independent access dimension for an authorized parent summary. */
export enum AgentThreadAccessStates
{
	/** Current participants may open the linked child conversation. */
	Available = "available",
	/** The parent may retain only the authorized restricted summary. */
	Restricted = "restricted"
}

/** Independent connection dimension for an authorized child snapshot. */
export enum AgentThreadRecoveryStates
{
	/** The browser has the latest accepted projection and live delivery is connected. */
	Live = "live",
	/** The browser is recovering from its last accepted cursor. */
	Reconnecting = "reconnecting"
}

/** Independent first-run admission dimension. */
export enum AgentThreadAdmissionStates
{
	/** The mention may create a child conversation and first run. */
	Available = "available",
	/** The child and first run exist but execution is waiting for capacity. */
	Queued = "queued",
	/** The signed-in participant may not invoke an Agent in this group. */
	Unauthorized = "unauthorized",
	/** This group has no Agent configured for invocation. */
	NoAgent = "no_agent",
	/** One exact mention command is in flight and duplicates are suppressed. */
	Submitting = "submitting"
}

/** Independent serial-run lifecycle shown inside one Agent thread. */
export enum AgentThreadRunStates
{
	/** The durable run exists and is waiting for execution capacity. */
	Queued = "queued",
	/** The current foreground run is executing. */
	Working = "working",
	/** The run is paused for a participant response or approval. */
	Waiting = "waiting",
	/** A visible attempt failed and the same run is retrying. */
	Retrying = "retrying",
	/** The run completed and may have delivered a safe result. */
	Completed = "completed",
	/** The run ended unsuccessfully without claiming a result. */
	Failed = "failed",
	/** A cancellation superseded the active attempt. */
	Cancelled = "cancelled"
}

/** Parent-summary states derived from child, run, access, and recovery dimensions. */
export enum AgentThreadSummaryStates
{
	/** Atomic child and first-run creation has not reached an authoritative result. */
	Starting = "starting",
	/** The active serial run is working. */
	Working = "working",
	/** The run needs participant input or approval. */
	Waiting = "waiting",
	/** A failed attempt is visibly retrying. */
	Retrying = "retrying",
	/** The latest run completed without a preceding visible retry. */
	Completed = "completed",
	/** The latest run completed after at least one visible retry. */
	CompletedAfterRetry = "completed_after_retry",
	/** The latest run ended unsuccessfully. */
	Failed = "failed",
	/** The latest run was cancelled. */
	Cancelled = "cancelled",
	/** The child conversation is closed and accepts no follow-up. */
	Closed = "closed",
	/** Current parent participants may see only a non-disclosing restricted summary. */
	Restricted = "restricted",
	/** Atomic mention admission failed without creating a usable child. */
	CreationFailed = "creation_failed",
	/** Live delivery is reconnecting from the last accepted cursor. */
	Reconnecting = "reconnecting"
}

/** Immediate-parent delivery categories safe to render in the child timeline or parent summary. */
export enum AgentThreadDeliveryKinds
{
	/** Short progress update. */
	Status = "status",
	/** Participant question backed by a recoverable elicitation. */
	Question = "question",
	/** Approval request backed by a recoverable elicitation. */
	Approval = "approval",
	/** Display-safe result summary. */
	Result = "result",
	/** Truthful failure summary that claims no result. */
	Failure = "failure",
	/** Finalized generated asset reference. */
	Asset = "asset"
}

/** Ordered child timeline entry categories. */
export enum AgentThreadTimelineEntryKinds
{
	/** A serial run began or changed lifecycle state. */
	RunBoundary = "run_boundary",
	/** A participant or Agent message. */
	Message = "message",
	/** An append-only delivery to the immediate parent. */
	Delivery = "delivery"
}

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
	readonly cursor: string;
	/** Whether the current state permits another serial follow-up. */
	readonly canSendFollowUp: boolean;
}

/** Dependency-neutral browser port; a generated-client adapter is added after OpenAPI exists. */
export interface AgentThreadGateway
{
	/** Read one exact authorized child projection. */
	read(parentConversationId: string, childConversationId: string): Promise<AgentThreadSnapshot>;
	/** Send one serial follow-up using a caller-created idempotency fence. */
	sendFollowUp(childConversationId: string, body: string, idempotencyKey: string): Promise<AgentThreadSnapshot>;
}
