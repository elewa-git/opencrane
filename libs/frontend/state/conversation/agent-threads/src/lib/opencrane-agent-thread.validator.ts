import { z } from "zod";

import type { AgentThreadSnapshotDto } from "./opencrane-agent-thread.mapper.types.js";

/** Bounded non-empty server text that is safe to retain as display input. */
const _Text = z.string().min(1).max(20_000);
/** Opaque authority coordinate retained for routing, never displayed as identity. */
const _Id = z.string().min(1).max(512);
/** Canonical non-negative decimal position. */
const _Position = z.string().regex(/^(0|[1-9][0-9]*)$/u);
/** Canonical timestamp accepted before any locale formatting occurs. */
const _Instant = z.string().datetime({ offset: true });

/** One canonical message content block. */
const _Block = z.object({
	id: _Id,
	kind: z.enum(["text", "artifact", "tool_call", "tool_result"]),
	value: z.string().max(20_000)
}).strict();

/** One bounded child message returned by the participant API. */
const _Message = z.object({
	id: _Id,
	position: _Position,
	role: z.enum(["user", "assistant", "tool", "system"]),
	state: z.enum(["pending", "streaming", "completed", "failed", "cancelled"]),
	source: z.enum(["user_input", "model_output", "tool_result", "platform"]),
	blocks: z.array(_Block).max(100),
	runId: _Id.nullable(),
	createdAt: _Instant,
	completedAt: _Instant.nullable()
}).strict();

/** One serial run boundary in the bounded child projection. */
const _Run = z.object({
	id: _Id,
	ordinal: z.number().int().positive(),
	attempt: z.number().int().positive(),
	state: z.enum(["queued", "working", "waiting", "retrying", "completed", "failed", "cancelled"]),
	acceptedAt: _Instant,
	finishedAt: _Instant.nullable()
}).strict();

/** One display-safe immediate-parent delivery. */
const _Delivery = z.object({
	id: _Id,
	childConversationId: _Id,
	parentConversationId: _Id,
	runId: _Id,
	kind: z.enum(["status", "question", "approval", "result", "failure", "asset"]),
	label: _Text,
	detail: _Text,
	assetId: _Id.nullable(),
	createdAt: _Instant
}).strict();

/** Strict generated response schema; unknown fields fail closed at every object boundary. */
const _Snapshot: z.ZodType<AgentThreadSnapshotDto> = z.object({
	parentConversationId: _Id,
	childConversationId: _Id,
	rootConversationId: _Id,
	parentMessageId: _Id,
	agentServiceId: _Id,
	agentName: _Text,
	ask: z.string().max(20_000),
	createdAt: _Instant,
	lifecycle: z.enum(["open", "closed"]),
	participantCount: z.number().int().positive().max(200),
	readThroughPosition: _Position,
	latestPosition: _Position,
	representedThroughPosition: _Position,
	messageCount: z.number().int().nonnegative(),
	unreadMessageCount: z.number().int().nonnegative(),
	cursor: z.string().min(1).max(4096).nullable(),
	messages: z.array(_Message).max(100),
	runs: z.array(_Run).max(100),
	deliveries: z.array(_Delivery).max(100)
}).strict().superRefine(function _Consistent(snapshot, context)
{
	// 1. The bounded window may end before latest, but it can never claim positions beyond latest.
	const latest = BigInt(snapshot.latestPosition);
	const represented = BigInt(snapshot.representedThroughPosition);
	const readThrough = BigInt(snapshot.readThroughPosition);
	if (represented > latest) context.addIssue({ code: z.ZodIssueCode.custom, path: ["representedThroughPosition"], message: "cannot exceed latestPosition" });
	if (readThrough > latest) context.addIssue({ code: z.ZodIssueCode.custom, path: ["readThroughPosition"], message: "cannot exceed latestPosition" });
	if ((represented === 0n) !== (snapshot.cursor === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["cursor"], message: "must match representedThroughPosition" });

	// 2. Exact unread and message counts must remain internally possible.
	if (snapshot.unreadMessageCount > snapshot.messageCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["unreadMessageCount"], message: "cannot exceed messageCount" });
	if (snapshot.messages.length > snapshot.messageCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["messages"], message: "cannot exceed messageCount" });

	// 3. Every displayed message must stay within the latest canonical position. The replay cursor
	// may remain lower when the snapshot omits a stream-only event before a later displayed message.
	for (const [index, message] of snapshot.messages.entries())
	{
		if (BigInt(message.position) > latest) context.addIssue({ code: z.ZodIssueCode.custom, path: ["messages", index, "position"], message: "exceeds latestPosition" });
	}
	for (const [index, delivery] of snapshot.deliveries.entries())
	{
		if (delivery.parentConversationId !== snapshot.parentConversationId || delivery.childConversationId !== snapshot.childConversationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["deliveries", index], message: "does not belong to this route" });
	}
});

/** Parse one untrusted generated-client response before it can enter browser state. */
export function __ParseAgentThreadSnapshotDto(value: unknown): AgentThreadSnapshotDto
{
	const parsed = _Snapshot.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new Error("The conversation authority returned an invalid Agent thread.");
}
