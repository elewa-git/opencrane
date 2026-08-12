import type { paths } from "@opencrane/contracts";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { AgentThreadAccessStates, AgentThreadDeliveryKinds, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadTimelineEntryKinds, type AgentThreadSnapshot, type AgentThreadTimelineEntry } from "./agent-thread.types.js";

/** Generated success DTO for one exact authorized Agent-thread route. */
export type AgentThreadSnapshotDto = paths["/me/conversations/{parentConversationId}/agent-threads/{childConversationId}"]["get"]["responses"][200]["content"]["application/json"]["agentThread"];

/** Map the generated wire DTO into the dependency-neutral Agent-thread view model. */
export function __AgentThreadSnapshot(dto: AgentThreadSnapshotDto): AgentThreadSnapshot
{
	_ValidateSnapshot(dto);
	const timeline = [
		...dto.runs.map(function _Run(run): _TimedEntry { return { occurredAt: run.acceptedAt, entry: { kind: AgentThreadTimelineEntryKinds.RunBoundary, id: `run:${run.id}`, run: { runId: run.id, ordinal: run.ordinal, state: run.state as AgentThreadRunStates, label: `Run ${run.ordinal}` } } }; }),
		...dto.messages.flatMap(function _Message(message): readonly _TimedEntry[]
		{
			if (message.role !== "user" && message.role !== "assistant") return [];
			const authoredByAgent = message.role === "assistant";
			const authorName = authoredByAgent ? dto.agentName : message.userId ?? dto.initiatorUserId;
			return [{ occurredAt: message.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Message, id: `message:${message.id}`, message: { id: message.id, authorName, authorInitials: _Initials(authorName), authoredByAgent, timestampLabel: _Time(message.createdAt), body: _MessageText(message.blocks) } } }];
		}),
		...dto.deliveries.map(function _Delivery(delivery): _TimedEntry { return { occurredAt: delivery.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Delivery, id: `delivery:${delivery.id}`, delivery: { id: delivery.id, kind: delivery.kind as AgentThreadDeliveryKinds, label: delivery.label, detail: delivery.detail, timestampLabel: _Time(delivery.createdAt), ...(delivery.assetId === null ? {} : { richCardId: delivery.assetId }) } } }; }),
	].sort(function _Chronological(left, right) { return left.occurredAt.localeCompare(right.occurredAt) || left.entry.id.localeCompare(right.entry.id); }).map(function _Entry(row) { return row.entry; });
	const latestRun = dto.runs.at(-1);
	const latestDelivery = dto.deliveries.at(-1);
	const latestMessage = [...dto.messages].reverse().find(function _VisibleMessage(message) { return message.role === "user" || message.role === "assistant"; });
	const preview = latestDelivery?.detail ?? (latestMessage === undefined ? undefined : _MessageText(latestMessage.blocks));
	return {
		parentConversationId: dto.parentConversationId,
		childConversationId: dto.childConversationId,
		origin: { parentTitle: dto.parentConversationId, parentMessageId: dto.parentMessageId, invokedByName: dto.initiatorUserId, invokedByInitials: _Initials(dto.initiatorUserId), ask: dto.ask, timestampLabel: _Time(dto.createdAt) },
		summary: { childConversationId: dto.childConversationId, state: _SummaryState(dto.lifecycle, latestRun?.state), access: AgentThreadAccessStates.Available, title: dto.agentName, ...(preview === undefined || preview.length === 0 ? {} : { preview }), unreadCount: dto.unreadMessageCount, participantInitials: dto.participantUserIds.map(_Initials), replyCount: dto.messageCount },
		recovery: AgentThreadRecoveryStates.Live,
		timeline,
		cursor: dto.cursor,
		canSendFollowUp: dto.lifecycle === "open" && (latestRun === undefined || latestRun.state === "completed" || latestRun.state === "failed" || latestRun.state === "cancelled"),
	};
}

/** Timeline row carrying the canonical timestamp only until the final stable ordering is resolved. */
interface _TimedEntry { readonly occurredAt: string; readonly entry: AgentThreadTimelineEntry }

/** Derive the compact parent state only from durable lifecycle and latest-run facts. */
function _SummaryState(lifecycle: AgentThreadSnapshotDto["lifecycle"], state: AgentThreadSnapshotDto["runs"][number]["state"] | undefined): AgentThreadSummaryStates
{
	if (lifecycle === "closed") return AgentThreadSummaryStates.Closed;
	if (state === undefined || state === "queued") return AgentThreadSummaryStates.Starting;
	if (state === "working") return AgentThreadSummaryStates.Working;
	if (state === "waiting") return AgentThreadSummaryStates.Waiting;
	if (state === "retrying") return AgentThreadSummaryStates.Retrying;
	if (state === "completed") return AgentThreadSummaryStates.Completed;
	if (state === "failed") return AgentThreadSummaryStates.Failed;
	return AgentThreadSummaryStates.Cancelled;
}

/** Join only server-validated text blocks; assets and tools keep their owning renderers. */
function _MessageText(blocks: AgentThreadSnapshotDto["messages"][number]["blocks"]): string
{
	return blocks.flatMap(function _Text(block): readonly string[] { return block.kind === MessageContentBlockKinds.Text ? [block.value] : []; }).join("\n");
}

/** Produce compact initials from the exact display string without inventing an identity. */
function _Initials(value: string): string
{
	const words = value.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	if (words.length > 1) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
	return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Format one already-validated canonical instant for compact rendering. */
function _Time(value: string): string
{
	const instant = new Date(value);
	if (!Number.isFinite(instant.getTime())) throw new Error("Agent thread contains an invalid timestamp");
	return instant.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Fail closed on coordinates and counts that cannot safely drive browser state. */
function _ValidateSnapshot(dto: AgentThreadSnapshotDto): void
{
	if (dto.parentConversationId.trim().length === 0 || dto.childConversationId.trim().length === 0 || dto.parentMessageId.trim().length === 0 || dto.agentName.trim().length === 0) throw new Error("Agent thread contains an invalid coordinate");
	if (!Number.isSafeInteger(dto.messageCount) || dto.messageCount < 0 || !Number.isSafeInteger(dto.unreadMessageCount) || dto.unreadMessageCount < 0 || dto.unreadMessageCount > dto.messageCount) throw new Error("Agent thread contains an invalid message count");
	if (!Number.isSafeInteger(dto.runs.length) || dto.runs.some(function _InvalidRun(run) { return !Number.isSafeInteger(run.ordinal) || run.ordinal < 1 || !Number.isSafeInteger(run.attempt) || run.attempt < 1; })) throw new Error("Agent thread contains an invalid run");
}
