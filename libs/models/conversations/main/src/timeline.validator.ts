// This validator admits untrusted replay coordinates and timeline entries; it stays beside the model so cursor binding and monotonic position rules cannot drift.
import { z } from "zod";

import { ConversationTimelineEntryKinds, type ConversationReplayCursor, type ConversationTimelineEntry } from "./timeline.types.js";

/** Non-empty OpenCrane-owned identifier accepted at the timeline boundary. */
const _IdentifierSchema = z.string().trim().min(1);

/** Canonical positive decimal representation of a database-owned BigInt position. */
const _PositionSchema = z.string().regex(/^[1-9]\d*$/, "must be a canonical positive decimal string");

/** Fields shared by each exact timeline source validator. */
const _TimelineEntryBaseShape = {
	conversationId: _IdentifierSchema,
	position: _PositionSchema,
	payload: z.record(z.unknown()).nullable(),
	occurredAt: z.string().datetime({ offset: true }),
};

/** Exact message-source timeline validator. */
const _MessageTimelineEntrySchema = z.object({ ..._TimelineEntryBaseShape, kind: z.literal(ConversationTimelineEntryKinds.Message), messageId: _IdentifierSchema }).strict();

/** Exact run-event-source timeline validator. */
const _RunEventTimelineEntrySchema = z.object({ ..._TimelineEntryBaseShape, kind: z.literal(ConversationTimelineEntryKinds.RunEvent), runId: _IdentifierSchema, runEventSequence: z.number().int().positive().safe() }).strict();

/** Exact membership-source timeline validator. */
const _MembershipTimelineEntrySchema = z.object({ ..._TimelineEntryBaseShape, kind: z.literal(ConversationTimelineEntryKinds.Membership), membershipEventId: _IdentifierSchema, participantUserId: _IdentifierSchema }).strict();

/** Exact system-source timeline validator. */
const _SystemTimelineEntrySchema = z.object({ ..._TimelineEntryBaseShape, kind: z.literal(ConversationTimelineEntryKinds.System), systemEventId: _IdentifierSchema }).strict();

/** Exact immediate-child-delivery timeline validator. */
const _ParentDeliveryTimelineEntrySchema = z.object({ ..._TimelineEntryBaseShape, kind: z.literal(ConversationTimelineEntryKinds.ParentDelivery), parentDeliveryChildRunId: _IdentifierSchema }).strict();

/** Strict validator for one database-owned canonical timeline position and exact source reference. */
export const ___ConversationTimelineEntrySchema: z.ZodType<ConversationTimelineEntry> = z.discriminatedUnion("kind", [_MessageTimelineEntrySchema, _RunEventTimelineEntrySchema, _MembershipTimelineEntrySchema, _SystemTimelineEntrySchema, _ParentDeliveryTimelineEntrySchema]);

/** Strict validator for a resumable cursor bound to one conversation and observed position. */
export const ___ConversationReplayCursorSchema: z.ZodType<ConversationReplayCursor> = z.object({ conversationId: _IdentifierSchema, position: _PositionSchema }).strict();
