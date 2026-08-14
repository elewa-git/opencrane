import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { AgentThreadDeliveryKinds, AgentThreadRunStates, AgentThreadTimelineEntryKinds, type AgentThreadDeliveryPresentation, type AgentThreadMessagePresentation, type AgentThreadRunBoundaryPresentation, type AgentThreadTimelineEntry } from "./agent-thread.types";
import type { AgentThreadDeliveryDto, AgentThreadMessageDto, AgentThreadRunDto, AgentThreadSnapshotDto, AgentThreadTimelineRow } from "./opencrane-agent-thread.mapper.types";

/** Exhaustive mapping from validated wire run states to browser state. */
const _RUN_STATES: Readonly<Record<AgentThreadRunDto["state"], AgentThreadRunStates>> = {
	queued: AgentThreadRunStates.Queued,
	working: AgentThreadRunStates.Working,
	waiting: AgentThreadRunStates.Waiting,
	retrying: AgentThreadRunStates.Retrying,
	completed: AgentThreadRunStates.Completed,
	failed: AgentThreadRunStates.Failed,
	cancelled: AgentThreadRunStates.Cancelled
};

/** Exhaustive mapping from validated wire delivery kinds to browser state. */
const _DELIVERY_KINDS: Readonly<Record<AgentThreadDeliveryDto["kind"], AgentThreadDeliveryKinds>> = {
	status: AgentThreadDeliveryKinds.Status,
	question: AgentThreadDeliveryKinds.Question,
	approval: AgentThreadDeliveryKinds.Approval,
	result: AgentThreadDeliveryKinds.Result,
	failure: AgentThreadDeliveryKinds.Failure,
	asset: AgentThreadDeliveryKinds.Asset
};

/** Merge validated run, message, and delivery rows into one stable chronological timeline. */
export function _AgentThreadTimeline(dto: AgentThreadSnapshotDto): readonly AgentThreadTimelineEntry[]
{
	const rows = [...dto.runs.map(_RunRow), ...dto.messages.flatMap(function _Message(message) { return _MessageRows(message, dto.agentName); }), ...dto.deliveries.map(_DeliveryRow)];
	return rows.sort(function _Chronological(left, right) { return left.occurredAt.localeCompare(right.occurredAt) || left.entry.id.localeCompare(right.entry.id); }).map(function _Entry(row) { return row.entry; });
}

/** Find the furthest position belonging to a message the transcript actually renders. */
export function _AgentThreadVisibleThroughPosition(messages: readonly AgentThreadMessageDto[]): string
{
	return messages.filter(_IsRenderedMessage).reduce(function _LatestPosition(latest, message) { return BigInt(message.position) > BigInt(latest) ? message.position : latest; }, "0");
}

/** Select the latest rendered message copy for the compact summary preview. */
export function _AgentThreadLatestMessageText(messages: readonly AgentThreadMessageDto[]): string | undefined
{
	const message = [...messages].reverse().find(_IsRenderedMessage);
	return message === undefined ? undefined : _MessageText(message.blocks);
}

/** Format one already-validated canonical instant for browser presentation. */
export function _AgentThreadTimeLabel(value: string): string
{
	const instant = new Date(value);
	if (!Number.isFinite(instant.getTime())) throw new Error("Agent thread contains an invalid timestamp");
	return instant.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Map one validated run to its browser-safe timeline row. */
function _RunRow(run: AgentThreadRunDto): AgentThreadTimelineRow
{
	const boundary: AgentThreadRunBoundaryPresentation = { runId: run.id, ordinal: run.ordinal, state: _RUN_STATES[run.state], label: `Run ${run.ordinal}` };
	return { occurredAt: run.acceptedAt, entry: { kind: AgentThreadTimelineEntryKinds.RunBoundary, id: `run:${run.id}`, run: boundary } };
}

/** Map a rendered message to one row while excluding tool and system messages. */
function _MessageRows(message: AgentThreadMessageDto, agentName: string): readonly AgentThreadTimelineRow[]
{
	if (!_IsRenderedMessage(message)) return [];
	const authoredByAgent = message.role === "assistant";
	const authorName = authoredByAgent ? agentName : "Participant";
	const presentation: AgentThreadMessagePresentation = { id: message.id, authorName, authorInitials: _Initials(authorName), authoredByAgent, timestampLabel: _AgentThreadTimeLabel(message.createdAt), body: _MessageText(message.blocks) };
	return [{ occurredAt: message.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Message, id: `message:${message.id}`, message: presentation } }];
}

/** Map one validated immediate-parent delivery to its browser-safe timeline row. */
function _DeliveryRow(delivery: AgentThreadDeliveryDto): AgentThreadTimelineRow
{
	const presentation: AgentThreadDeliveryPresentation = { id: delivery.id, kind: _DELIVERY_KINDS[delivery.kind], label: delivery.label, detail: delivery.detail, timestampLabel: _AgentThreadTimeLabel(delivery.createdAt), ...(delivery.assetId === null ? {} : { richCardId: delivery.assetId }) };
	return { occurredAt: delivery.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Delivery, id: `delivery:${delivery.id}`, delivery: presentation } };
}

/** Keep read-through coordinates aligned with roles rendered by the transcript. */
function _IsRenderedMessage(message: AgentThreadMessageDto): boolean
{
	return message.role === "user" || message.role === "assistant";
}

/** Join only server-validated text blocks; assets and tools keep their owning renderers. */
function _MessageText(blocks: AgentThreadMessageDto["blocks"]): string
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
