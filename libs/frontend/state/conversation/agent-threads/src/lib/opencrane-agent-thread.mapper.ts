import { AgentThreadRecoveryStates, AgentThreadRunStates, type AgentThreadSnapshot } from "./agent-thread.types";
import { _AgentThreadLifecycleStates, type AgentThreadRunDto, type AgentThreadSnapshotDto } from "./opencrane-agent-thread.mapper.types";
import { _AgentThreadOrigin, _AgentThreadSummary } from "./opencrane-agent-thread.summary.mapper";
import { _AgentThreadTimeline, _AgentThreadVisibleThroughPosition } from "./opencrane-agent-thread.timeline.mapper";
import { __ParseAgentThreadSnapshotDto } from "./opencrane-agent-thread.validator";

/** Map one untrusted wire value into the complete dependency-neutral Agent-thread view model. */
export function __AgentThreadSnapshot(value: unknown): AgentThreadSnapshot
{
	const dto = __ParseAgentThreadSnapshotDto(value);
	return {
		parentConversationId: dto.parentConversationId,
		childConversationId: dto.childConversationId,
		origin: _AgentThreadOrigin(dto),
		summary: _AgentThreadSummary(dto),
		recovery: AgentThreadRecoveryStates.Live,
		timeline: _AgentThreadTimeline(dto),
		cursor: dto.cursor,
		latestPosition: dto.latestPosition,
		representedThroughPosition: dto.representedThroughPosition,
		visibleThroughPosition: _AgentThreadVisibleThroughPosition(dto.messages),
		canSendFollowUp: _CanSendFollowUp(dto.lifecycle, dto.runs.at(-1))
	};
}

/** Admit a serial follow-up only before closure and after a terminal or absent run. */
function _CanSendFollowUp(lifecycle: AgentThreadSnapshotDto["lifecycle"], latestRun: AgentThreadRunDto | undefined): boolean
{
	if (lifecycle === _AgentThreadLifecycleStates.Closed) return false;
	if (latestRun === undefined) return true;
	return latestRun.state === AgentThreadRunStates.Completed || latestRun.state === AgentThreadRunStates.Failed || latestRun.state === AgentThreadRunStates.Cancelled;
}
