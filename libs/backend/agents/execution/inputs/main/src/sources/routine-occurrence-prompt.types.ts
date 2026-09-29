import type { RunAdmissionCommand, RunAdmissionRoutineInput } from "@opencrane/backend/agents/execution/runs";
import type { MessageId } from "@opencrane/models/conversations";

/** Service-owned query for the prompt prepared for one exact routine occurrence. */
export interface RoutineOccurrencePromptAdmissionQuery
{
	/** Silo containing the routine, occurrence conversation, and managed agent. */
	readonly siloId: string;
	/** Independent agent-session conversation allocated to this occurrence. */
	readonly conversationId: string;
	/** Managed AgentService selected by the current routine firing. */
	readonly agentServiceId: string;
	/** Automatic or manual run trigger mapped by the scheduling owner. */
	readonly trigger: Exclude<RunAdmissionCommand["trigger"], "interactive">;
	/** Exact stored routine and firing coordinates; none originate in a browser request. */
	readonly routine: RunAdmissionRoutineInput;
}

/** Canonical service-authored message set prepared for one routine occurrence. */
export interface RoutineOccurrencePromptAdmissionRead
{
	/** Durable history revision through which the occurrence prompt was attested. */
	readonly historyRevision: string;
	/** Canonical service-authored message identifiers in prompt order. */
	readonly orderedMessageIds: readonly MessageId[];
}

/** Reads a prepared occurrence prompt through the trusted conversation-history service boundary. */
export interface RoutineOccurrencePromptAdmissionReader
{
	/** Return the exact attested prompt or null when any routine, firing, or conversation coordinate differs. */
	read(query: RoutineOccurrencePromptAdmissionQuery): Promise<RoutineOccurrencePromptAdmissionRead | null>;
}
