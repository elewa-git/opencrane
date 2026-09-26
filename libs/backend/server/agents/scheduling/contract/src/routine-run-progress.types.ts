import type { AgentRunState, AgentRunTerminalReason, RoutineFiringDisposition } from "@opencrane/models/agents";

/**
 * Reports an outcome verified from a saved run and its conversation history, without copying
 * result content. Scheduling compares the source fields with the current linked run before writing.
 * A non-null result reference and digest identify the evidence verified for this report; they may
 * differ from an earlier uncertainty receipt retained by scheduling. Reporting grants no permission
 * to resume execution.
 */
export interface RoutineRunProgressObservation
{
	/** Identifies the organisation that owns both records. */
	readonly siloId: string;
	/** Identifies the routine whose firing is being observed. */
	readonly routineId: string;
	/** Identifies the immutable instruction and audience revision used by this firing. */
	readonly routineRevision: number;
	/** Identifies the firing linked to the run by admission. */
	readonly firingId: string;
	/** Identifies the already-admitted run; the observer cannot create another. */
	readonly runId: string;
	/** Identifies the run attempt whose saved history was verified. */
	readonly attempt: number;
	/** Binds the observation to the run's immutable input snapshot. */
	readonly inputSnapshotDigest: `sha256:${string}`;
	/** Records the run state read before the corresponding history was checked. */
	readonly sourceState: AgentRunState;
	/** Carries the run's canonical ISO finish time, or null while it is unfinished. */
	readonly sourceFinishedAt: string | null;
	/** Carries the run's saved terminal reason, or null before completion. */
	readonly sourceTerminalReason: AgentRunTerminalReason | null;
	/** Carries the saved Stop command identifier, or null if none was admitted. */
	readonly sourceCancellationCommandId: string | null;
	/** Binds that Stop command to its immutable arguments, or is null with its identifier. */
	readonly sourceCancellationCommandDigest: `sha256:${string}` | null;
	/** Selects a progress state proven by the run and saved turn protocol. */
	readonly disposition: RoutineFiringDisposition;
	/** References the newly verified answer, uncertainty or cancellation evidence; absent for waits. */
	readonly resultReference: string | null;
	/** Binds that newly verified evidence to its saved bytes or canonical receipt. */
	readonly resultDigest: `sha256:${string}` | null;
}

/**
 * Saves historical execution progress without admitting work or checking fresh execution grants.
 * Callers must await this write before acknowledging the corresponding producer step. A failure
 * leaves the producer's saved evidence available for retry; it must not trigger another effect.
 */
export interface RoutineRunProgressSink
{
	/** Rechecks the linked run, saves progress, and retains the firing's first evidence pair. */
	recordRunProgress(observation: RoutineRunProgressObservation): Promise<void>;
}
