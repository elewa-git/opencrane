import type { AgentRunTerminalReason, RoutineFiringTrigger } from "@opencrane/models/agents";

/** Routine and firing coordinates that a history caller already loaded. */
export interface RoutineRunHistoryRequest
{
	/** Stable linked run identifier. */
	readonly runId: string;
	/** Organisation that owns the run and firing. */
	readonly siloId: string;
	/** Routine linked on both records. */
	readonly routineId: string;
	/** Immutable routine revision linked on both records. */
	readonly routineRevision: number;
	/** Firing linked reciprocally to the run. */
	readonly firingId: string;
	/** Occurrence conversation linked on both records. */
	readonly conversationId: string;
	/** Routine trigger that must agree with the saved run trigger. */
	readonly trigger: RoutineFiringTrigger;
	/** Automatic slot that must agree with the run snapshot, or null for manual work. */
	readonly scheduledSlot: string | null;
}

/** Checked terminal and settled-cost facts safe for routine history projection. */
export interface RoutineRunHistoryFact
{
	/** Stable run identifier supplied in the request. */
	readonly runId: string;
	/** Persisted terminal classification, or null while the run is unfinished. */
	readonly terminalReason: AgentRunTerminalReason | null;
	/** Provider cost already settled on the run, or null when no complete cost pair exists. */
	readonly actualCost: { readonly amount: string; readonly currency: string } | null;
}

/** Execution-owned reader that validates run and firing backlinks before exposing history facts. */
export interface RoutineRunHistoryRepository
{
	/** Returns one fact for every supplied coordinate or throws when stored linkage is inconsistent. */
	read(requests: readonly RoutineRunHistoryRequest[]): Promise<readonly RoutineRunHistoryFact[]>;
}
