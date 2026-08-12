import type { ConversationId, MessageId } from "./identifiers.types.js";

/**
 * What kind of record occupies one timeline position.
 *
 * The timeline is an ordering only. Each entry points at the real record — a message, a run event,
 * a membership change — and a reader must still fetch that record and honour its own access
 * checks. Reading the timeline never grants access to what it points at.
 */
export enum ConversationTimelineEntryKinds
{
	/** Canonical participant or run-backed message. */
	Message = "message",
	/** Ordered event from one admitted agent run. */
	RunEvent = "run_event",
	/** Participant join or access-boundary event. */
	Membership = "membership",
	/** Platform-authored lifecycle or informational event. */
	System = "system",
	/** Sanitized append-only delivery from an immediate child conversation. */
	ParentDelivery = "parent_delivery",
}

/** The fields every timeline entry has. `position` is allocated by the database, so a writer must never choose one. */
export interface ConversationTimelineEntryBase
{
	/** Conversation owning this sequence position. */
	readonly conversationId: ConversationId;
	/** Position in this conversation, starting at 1 with no gaps. The database allocates it atomically, so two concurrent writers cannot get the same number. */
	readonly position: string;
	/** A small safe-to-display copy of the source, or null when the reader must fetch the referenced record instead. */
	readonly payload: Readonly<Record<string, unknown>> | null;
	/** ISO-8601 instant at which the timeline position was committed. */
	readonly occurredAt: string;
}

/** Timeline position referencing one canonical conversation message. */
export interface ConversationMessageTimelineEntry extends ConversationTimelineEntryBase
{
	/** Discriminant selecting the canonical message source. */
	readonly kind: ConversationTimelineEntryKinds.Message;
	/** Message ordered at this position. */
	readonly messageId: MessageId;
}

/** Timeline position referencing one ordered event from an admitted agent run. */
export interface ConversationRunEventTimelineEntry extends ConversationTimelineEntryBase
{
	/** Discriminant selecting the ordered run-event source. */
	readonly kind: ConversationTimelineEntryKinds.RunEvent;
	/** Agent run that owns the event. */
	readonly runId: string;
	/** One-based contiguous sequence within the run. */
	readonly runEventSequence: number;
}

/** Timeline position referencing one durable participant membership event. */
export interface ConversationMembershipTimelineEntry extends ConversationTimelineEntryBase
{
	/** Discriminant selecting the membership-event source. */
	readonly kind: ConversationTimelineEntryKinds.Membership;
	/** Stable membership-event identifier. */
	readonly membershipEventId: string;
	/** Participant whose membership boundary changed. */
	readonly participantUserId: string;
}

/** Timeline position referencing one platform-authored system event. */
export interface ConversationSystemTimelineEntry extends ConversationTimelineEntryBase
{
	/** Discriminant selecting the system-event source. */
	readonly kind: ConversationTimelineEntryKinds.System;
	/** Stable system-event identifier. */
	readonly systemEventId: string;
}

/** Timeline position referencing one sanitized immediate-child delivery. */
export interface ConversationParentDeliveryTimelineEntry extends ConversationTimelineEntryBase
{
	/** Discriminant selecting the child-delivery source. */
	readonly kind: ConversationTimelineEntryKinds.ParentDelivery;
	/** Child run whose idempotent delivery was appended to its immediate parent. */
	readonly parentDeliveryChildRunId: string;
}

/** Exact source reference occupying one canonical conversation timeline position. */
export type ConversationTimelineEntry = ConversationMessageTimelineEntry | ConversationRunEventTimelineEntry | ConversationMembershipTimelineEntry | ConversationSystemTimelineEntry | ConversationParentDeliveryTimelineEntry;

/**
 * Where a client resumes replaying one conversation.
 *
 * Bound to a single conversation: a cursor from one conversation must never be accepted for
 * another. `subframe` is present only when a client stopped part-way through the AG-UI events
 * produced by one timeline row, and absent when that row was fully delivered.
 * @see {@link __ProjectAgUiEvents}
 */
export interface ConversationReplayCursor
{
	/** Conversation whose replay may resume. */
	readonly conversationId: ConversationId;
	/** Last positive timeline position already observed; absence of a cursor represents the beginning. */
	readonly position: string;
	/** Last deterministic AG-UI subframe observed within the position; absent means the row is complete. */
	readonly subframe?: number;
}
