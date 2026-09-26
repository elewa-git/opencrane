import type { RoutineRunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import { AgentRunTriggers, RoutineFiringTrigger } from "@opencrane/models/agents";

import { _RoutineEventId } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Derives root-run provenance only from the checked occurrence record. */
export function _RoutineRunCommand(record: RoutineOccurrenceHistoryRecord): RoutineRunAdmissionCommand
{
	return {
		runId: _RoutineEventId("run", record.conversationId), siloId: record.siloId,
		agentServiceId: record.agentServiceId, conversationId: record.conversationId,
		requestIdempotencyKey: _RoutineEventId("instruction", record.conversationId), messageInput: null,
		trigger: record.origin.trigger === RoutineFiringTrigger.Automatic ? AgentRunTriggers.Scheduled : AgentRunTriggers.Manual,
		routineInput: {
			routineId: record.origin.routineId, routineRevision: record.origin.routineRevision,
			firingId: record.origin.firingId, scheduledSlot: record.origin.scheduledSlot,
			requesterPrincipalId: record.requesterPrincipalId, requesterIssuer: record.requesterIssuer,
			requesterSubjectId: record.requesterSubjectId, requesterAuthenticatedAt: record.requesterAuthenticatedAt,
			workflowTaskId: record.task.taskId, workflowTaskName: record.task.taskName, workflowTaskKey: record.task.idempotencyKey,
		},
	};
}
