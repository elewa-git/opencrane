import { isDeepStrictEqual } from "node:util";

import type { RoutineOccurrencePromptAdmissionQuery, RoutineOccurrencePromptAdmissionRead, RoutineOccurrencePromptAdmissionReader } from "@opencrane/backend/agents/execution/inputs";
import { AgentRunTriggers, RoutineFiringTrigger } from "@opencrane/models/agents";

import type { RoutineOccurrenceHistory } from "./routine-occurrence-history";
import { _RoutineEventId } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Keeps the firing-to-run trigger translation closed and exhaustive. */
const _RUN_TRIGGER_BY_FIRING: Readonly<Record<RoutineFiringTrigger, RoutineOccurrencePromptAdmissionQuery["trigger"]>> = {
	[RoutineFiringTrigger.Automatic]: AgentRunTriggers.Scheduled,
	[RoutineFiringTrigger.Manual]: AgentRunTriggers.Manual,
};

/**
 * Resolves only the service-attested instruction prepared for one exact routine firing.
 *
 * Admission supplies the saved task and original requester evidence, not browser message IDs.
 * The history owner verifies genesis, instruction, receipt and computer before this adapter
 * compares that evidence with admission. It never inherits messages from the destination chat
 * or refreshes the requester's login. Current execution permission remains the admission owner's
 * responsibility inside its database fence.
 */
export class RoutineOccurrencePromptHistoryReader implements RoutineOccurrencePromptAdmissionReader
{
	/** Requires the checked history owner rather than a raw event or participant-facing reader. */
	public constructor(private readonly history: Pick<RoutineOccurrenceHistory, "readRecord">) {}

	/** Returns the frozen first instruction, excluding messages appended after preparation. */
	public async read(query: RoutineOccurrencePromptAdmissionQuery): Promise<RoutineOccurrencePromptAdmissionRead | null>
	{
		const record = await this.readRecord(query);
		if (record === null)
		{
			return null;
		}
		return { historyRevision: "1", orderedMessageIds: [_RoutineEventId("instruction", record.conversationId)] };
	}

	/**
	 * Reuses the exact admission binding when the routine-specific prompt source decrypts its payload.
	 * @returns Null for absence or query mismatch; corrupt durable evidence propagates as an error.
	 */
	public async readRecord(query: RoutineOccurrencePromptAdmissionQuery): Promise<RoutineOccurrenceHistoryRecord | null>
	{
		const record = await this.history.readRecord(query.siloId, query.conversationId);
		if (record === null || !isDeepStrictEqual(query, _AdmissionQuery(record)))
		{
			return null;
		}
		return record;
	}
}

/** Compares every independently supplied admission coordinate without normalising original evidence. */
function _AdmissionQuery(record: RoutineOccurrenceHistoryRecord): RoutineOccurrencePromptAdmissionQuery
{
	return {
		siloId: record.siloId,
		conversationId: record.conversationId,
		agentServiceId: record.agentServiceId,
		trigger: _RUN_TRIGGER_BY_FIRING[record.origin.trigger],
		routine: {
			routineId: record.origin.routineId,
			routineRevision: record.origin.routineRevision,
			firingId: record.origin.firingId,
			scheduledSlot: record.origin.scheduledSlot,
			requesterPrincipalId: record.requesterPrincipalId,
			requesterIssuer: record.requesterIssuer,
			requesterSubjectId: record.requesterSubjectId,
			requesterAuthenticatedAt: record.requesterAuthenticatedAt,
			workflowTaskId: record.task.taskId,
			workflowTaskName: record.task.taskName,
			workflowTaskKey: record.task.idempotencyKey,
		},
	};
}
