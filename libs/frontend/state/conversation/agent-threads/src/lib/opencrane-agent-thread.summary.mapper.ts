import { AgentThreadAccessStates, AgentThreadDeliveryKinds, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadSummaryTargetKinds, type AgentThreadOriginPresentation, type AgentThreadParticipantPresentation, type AgentThreadSummaryPresentation, type AgentThreadSummaryTarget } from "./agent-thread.types";
import { _AgentThreadLifecycleStates, type AgentThreadDeliveryDto, type AgentThreadRunDto, type AgentThreadSnapshotDto } from "./opencrane-agent-thread.mapper.types";
import { _AgentThreadLatestMessageText, _AgentThreadTimeLabel } from "./opencrane-agent-thread.timeline.mapper";

/** Map the immutable parent origin without exposing authority subject identifiers. */
export function _AgentThreadOrigin(dto: AgentThreadSnapshotDto): AgentThreadOriginPresentation
{
	return { parentTitle: "Group conversation", parentMessageId: dto.parentMessageId, invokedByName: "Invoking participant", invokedByInitials: "IP", ask: dto.ask, timestampLabel: _AgentThreadTimeLabel(dto.createdAt) };
}

/** Derive the compact parent summary from validated child facts. */
export function _AgentThreadSummary(dto: AgentThreadSnapshotDto): AgentThreadSummaryPresentation
{
	const latestRun = dto.runs.at(-1);
	const latestDelivery = dto.deliveries.at(-1);
	const result = [...dto.deliveries].reverse().find(function _Result(delivery) { return delivery.kind === AgentThreadDeliveryKinds.Result || delivery.kind === AgentThreadDeliveryKinds.Asset; });
	const preview = latestDelivery?.detail ?? _AgentThreadLatestMessageText(dto.messages);
	return {
		childConversationId: dto.childConversationId,
		state: _SummaryState(dto.lifecycle, latestRun?.state),
		access: AgentThreadAccessStates.Available,
		title: dto.agentName,
		...(preview === undefined || preview.length === 0 ? {} : { preview }),
		unreadCount: dto.unreadMessageCount,
		participants: _Participants(dto.participantCount),
		replyCount: dto.messageCount,
		runCount: latestRun?.ordinal ?? 0,
		updateCount: dto.messageCount + dto.deliveries.length,
		lastUpdateLabel: _AgentThreadTimeLabel(_LatestUpdateAt(dto)),
		assetCount: dto.deliveries.filter(function _Asset(delivery) { return delivery.kind === AgentThreadDeliveryKinds.Asset; }).length,
		...(result === undefined ? {} : { resultLabel: result.label }),
		target: _SummaryTarget(latestRun, latestDelivery, result)
	};
}

/** Select the exact child focus target promised by the current parent summary. */
function _SummaryTarget(latestRun: AgentThreadRunDto | undefined, latestDelivery: AgentThreadDeliveryDto | undefined, result: AgentThreadDeliveryDto | undefined): AgentThreadSummaryTarget
{
	if (latestRun?.state === AgentThreadRunStates.Waiting && latestDelivery !== undefined && (latestDelivery.kind === AgentThreadDeliveryKinds.Question || latestDelivery.kind === AgentThreadDeliveryKinds.Approval)) return { kind: AgentThreadSummaryTargetKinds.WaitingRequest, id: `delivery:${latestDelivery.id}` };
	if (latestRun?.state === AgentThreadRunStates.Failed) return { kind: AgentThreadSummaryTargetKinds.Failure, id: `run:${latestRun.id}` };
	if (latestRun?.state === AgentThreadRunStates.Completed && result !== undefined) return { kind: AgentThreadSummaryTargetKinds.FinalResult, id: `delivery:${result.id}` };
	return { kind: AgentThreadSummaryTargetKinds.Thread, id: "agent-thread-origin" };
}

/** Derive the compact parent state only from durable lifecycle and latest-run facts. */
function _SummaryState(lifecycle: AgentThreadSnapshotDto["lifecycle"], state: AgentThreadRunDto["state"] | undefined): AgentThreadSummaryStates
{
	if (lifecycle === _AgentThreadLifecycleStates.Closed) return AgentThreadSummaryStates.Closed;
	if (state === undefined || state === AgentThreadRunStates.Queued) return AgentThreadSummaryStates.Starting;
	if (state === AgentThreadRunStates.Working) return AgentThreadSummaryStates.Working;
	if (state === AgentThreadRunStates.Waiting) return AgentThreadSummaryStates.Waiting;
	if (state === AgentThreadRunStates.Retrying) return AgentThreadSummaryStates.Retrying;
	if (state === AgentThreadRunStates.Completed) return AgentThreadSummaryStates.Completed;
	if (state === AgentThreadRunStates.Failed) return AgentThreadSummaryStates.Failed;
	return AgentThreadSummaryStates.Cancelled;
}

/** Build display-safe participant placeholders without admitting opaque subject identifiers. */
function _Participants(count: number): readonly AgentThreadParticipantPresentation[]
{
	return Array.from({ length: count }, function _Participant(_value, index)
	{
		const label = `Participant ${index + 1}`;
		return { label, initials: `P${index + 1}` };
	});
}

/** Select the latest represented update across the root, messages, and deliveries. */
function _LatestUpdateAt(dto: AgentThreadSnapshotDto): string
{
	return [dto.createdAt, ...dto.messages.map(function _MessageTime(message) { return message.createdAt; }), ...dto.deliveries.map(function _DeliveryTime(delivery) { return delivery.createdAt; })].sort().at(-1) ?? dto.createdAt;
}
