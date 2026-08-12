import type { paths } from "@opencrane/contracts";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";

import { AgentThreadAccessStates, AgentThreadDeliveryKinds, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadSummaryTargetKinds, AgentThreadTimelineEntryKinds, type AgentThreadSnapshot, type AgentThreadSummaryTarget, type AgentThreadTimelineEntry } from "./agent-thread.types.js";
import { __ParseAgentThreadSnapshotDto } from "./opencrane-agent-thread.validator.js";

/** Generated success DTO for one exact authorized Agent-thread route. */
export type AgentThreadSnapshotDto = paths["/me/conversations/{parentConversationId}/agent-threads/{childConversationId}"]["get"]["responses"][200]["content"]["application/json"]["agentThread"];

/** Map the generated wire DTO into the dependency-neutral Agent-thread view model. */
export function __AgentThreadSnapshot(value: unknown): AgentThreadSnapshot
{
	const dto = __ParseAgentThreadSnapshotDto(value);
	const timeline = [
		...dto.runs.map(function _Run(run): _TimedEntry { return { occurredAt: run.acceptedAt, entry: { kind: AgentThreadTimelineEntryKinds.RunBoundary, id: `run:${run.id}`, run: { runId: run.id, ordinal: run.ordinal, state: _RunState(run.state), label: `Run ${run.ordinal}` } } }; }),
		...dto.messages.flatMap(function _Message(message): readonly _TimedEntry[]
		{
			if (message.role !== "user" && message.role !== "assistant") return [];
			const authoredByAgent = message.role === "assistant";
			const authorName = authoredByAgent ? dto.agentName : "Participant";
			return [{ occurredAt: message.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Message, id: `message:${message.id}`, message: { id: message.id, authorName, authorInitials: _Initials(authorName), authoredByAgent, timestampLabel: _Time(message.createdAt), body: _MessageText(message.blocks) } } }];
		}),
		...dto.deliveries.map(function _Delivery(delivery): _TimedEntry { return { occurredAt: delivery.createdAt, entry: { kind: AgentThreadTimelineEntryKinds.Delivery, id: `delivery:${delivery.id}`, delivery: { id: delivery.id, kind: _DeliveryKind(delivery.kind), label: delivery.label, detail: delivery.detail, timestampLabel: _Time(delivery.createdAt), ...(delivery.assetId === null ? {} : { richCardId: delivery.assetId }) } } }; }),
	].sort(function _Chronological(left, right) { return left.occurredAt.localeCompare(right.occurredAt) || left.entry.id.localeCompare(right.entry.id); }).map(function _Entry(row) { return row.entry; });
	const latestRun = dto.runs.at(-1);
	const latestDelivery = dto.deliveries.at(-1);
	const latestMessage = [...dto.messages].reverse().find(function _VisibleMessage(message) { return message.role === "user" || message.role === "assistant"; });
	const preview = latestDelivery?.detail ?? (latestMessage === undefined ? undefined : _MessageText(latestMessage.blocks));
	const latestUpdateAt = [dto.createdAt, ...dto.messages.map(function _MessageTime(message) { return message.createdAt; }), ...dto.deliveries.map(function _DeliveryTime(delivery) { return delivery.createdAt; })].sort().at(-1) ?? dto.createdAt;
	const result = [...dto.deliveries].reverse().find(function _Result(delivery) { return delivery.kind === "result" || delivery.kind === "asset"; });
	return {
		parentConversationId: dto.parentConversationId,
		childConversationId: dto.childConversationId,
		origin: { parentTitle: "Group conversation", parentMessageId: dto.parentMessageId, invokedByName: "Invoking participant", invokedByInitials: "IP", ask: dto.ask, timestampLabel: _Time(dto.createdAt) },
		summary: { childConversationId: dto.childConversationId, state: _SummaryState(dto.lifecycle, latestRun?.state), access: AgentThreadAccessStates.Available, title: dto.agentName, ...(preview === undefined || preview.length === 0 ? {} : { preview }), unreadCount: dto.unreadMessageCount, participants: dto.participantUserIds.map(function _Participant(_id, index) { const label = `Participant ${index + 1}`; return { label, initials: `P${index + 1}` }; }), replyCount: dto.messageCount, runCount: latestRun?.ordinal ?? 0, updateCount: dto.messageCount + dto.deliveries.length, lastUpdateLabel: _Time(latestUpdateAt), assetCount: dto.deliveries.filter(function _Asset(delivery) { return delivery.kind === "asset"; }).length, ...(result === undefined ? {} : { resultLabel: result.label }), target: _SummaryTarget(latestRun, latestDelivery, result) },
		recovery: AgentThreadRecoveryStates.Live,
		timeline,
		cursor: dto.cursor,
		latestPosition: dto.latestPosition,
		representedThroughPosition: dto.representedThroughPosition,
		canSendFollowUp: dto.lifecycle === "open" && (latestRun === undefined || latestRun.state === "completed" || latestRun.state === "failed" || latestRun.state === "cancelled"),
	};
}

/** Timeline row carrying the canonical timestamp only until the final stable ordering is resolved. */
interface _TimedEntry { readonly occurredAt: string; readonly entry: AgentThreadTimelineEntry }

/** Map the fully validated wire run state without an unchecked assertion. */
function _RunState(state: AgentThreadSnapshotDto["runs"][number]["state"]): AgentThreadRunStates
{
	const states: Readonly<Record<AgentThreadSnapshotDto["runs"][number]["state"], AgentThreadRunStates>> = {
		queued: AgentThreadRunStates.Queued, working: AgentThreadRunStates.Working, waiting: AgentThreadRunStates.Waiting, retrying: AgentThreadRunStates.Retrying, completed: AgentThreadRunStates.Completed, failed: AgentThreadRunStates.Failed, cancelled: AgentThreadRunStates.Cancelled
	};
	return states[state];
}

/** Map the fully validated wire delivery kind into the shared contract enum. */
function _DeliveryKind(kind: AgentThreadSnapshotDto["deliveries"][number]["kind"]): AgentThreadDeliveryKinds
{
	const kinds: Readonly<Record<AgentThreadSnapshotDto["deliveries"][number]["kind"], AgentThreadDeliveryKinds>> = {
		status: AgentThreadDeliveryKinds.Status, question: AgentThreadDeliveryKinds.Question, approval: AgentThreadDeliveryKinds.Approval, result: AgentThreadDeliveryKinds.Result, failure: AgentThreadDeliveryKinds.Failure, asset: AgentThreadDeliveryKinds.Asset
	};
	return kinds[kind];
}

/** Select the exact child focus target promised by the current parent summary. */
function _SummaryTarget(latestRun: AgentThreadSnapshotDto["runs"][number] | undefined, latestDelivery: AgentThreadSnapshotDto["deliveries"][number] | undefined, result: AgentThreadSnapshotDto["deliveries"][number] | undefined): AgentThreadSummaryTarget
{
	if (latestRun?.state === "waiting" && latestDelivery !== undefined && (latestDelivery.kind === "question" || latestDelivery.kind === "approval")) return { kind: AgentThreadSummaryTargetKinds.WaitingRequest, id: `delivery:${latestDelivery.id}` };
	if (latestRun?.state === "failed") return { kind: AgentThreadSummaryTargetKinds.Failure, id: `run:${latestRun.id}` };
	if (latestRun?.state === "completed" && result !== undefined) return { kind: AgentThreadSummaryTargetKinds.FinalResult, id: `delivery:${result.id}` };
	return { kind: AgentThreadSummaryTargetKinds.Thread, id: "agent-thread-origin" };
}

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
