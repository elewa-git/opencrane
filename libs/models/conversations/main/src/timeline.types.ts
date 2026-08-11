import type { ConversationId, MessageId } from "./identifiers.types.js";

/**
 * Stable source kinds for one database-ordered conversation timeline.
 *
 * The persisted values identify a source record; they never replace the source authority.
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

/** Fields shared by every database-owned conversation timeline position. */
export interface ConversationTimelineEntryBase
{
	/** Conversation owning this sequence position. */
	readonly conversationId: ConversationId;
	/** One-based monotonic position allocated atomically within the conversation. */
	readonly position: string;
	/** Display-safe source payload, or null when the referenced record owns all data. */
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

/** Resumable replay coordinate bound to exactly one conversation and monotonic position. */
export interface ConversationReplayCursor
{
	/** Conversation whose replay may resume. */
	readonly conversationId: ConversationId;
	/** Last positive timeline position already observed; absence of a cursor represents the beginning. */
	readonly position: string;
}
