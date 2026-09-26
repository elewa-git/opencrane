import { AgentRunTriggers } from "@opencrane/models/agents";
import type { ExecutionSubject, AgentRunState, AgentRunTerminalReason } from "@opencrane/models/agents";

/** Historical coordinates and terminal evidence needed to observe one admitted routine run. */
export interface RoutineRunProgressFacts
{
	/** Stable run identifier. */
	readonly runId: string;
	/** Silo that owns the run and its routine evidence. */
	readonly siloId: string;
	/** Immutable attempt number. */
	readonly attempt: number;
	/** Persisted lifecycle state. */
	readonly state: AgentRunState;
	/** Terminal completion time, or null while unsettled. */
	readonly finishedAt: string | null;
	/** Persisted terminal classification, or null while unsettled. */
	readonly terminalReason: AgentRunTerminalReason | null;
	/** Trigger that admitted the run. */
	readonly trigger: `${AgentRunTriggers.Scheduled}` | `${AgentRunTriggers.Manual}`;
	/** Immutable execution identity coordinates. */
	readonly agentServiceId: string;
	/** Immutable published revision executed by the run. */
	readonly agentRevisionId: string;
	/** Immutable agent identity selected by admission. */
	readonly agentIdentityId: string;
	/** Managed execution principal that owns the admitted run; the requester is in executionSubject. */
	readonly principalId: string;
	/** Conversation receiving the routine output. */
	readonly conversationId: string | null;
	/** Admission idempotency key. */
	readonly requestIdempotencyKey: string;
	/** Digest of the immutable first-attempt input snapshot. */
	readonly inputSnapshotDigest: string;
	/** Immutable routine occurrence coordinates. */
	readonly routine: RoutineRunProgressRoutine;
	/** Validated execution subject frozen at admission. */
	readonly executionSubject: ExecutionSubject;
	/** Original turn workflow receipt bound to this run. */
	readonly originalTurnTask: RoutineRunProgressTask;
	/** Historical cancellation admission and winner evidence, when Stop was admitted. */
	readonly cancellation: RoutineRunProgressCancellation | null;
}

/** Routine occurrence coordinates copied from the reciprocal firing and run rows. */
export interface RoutineRunProgressRoutine
{
	/** Stable routine aggregate identifier. */
	readonly routineId: string;
	/** Positive routine revision executed by the occurrence. */
	readonly routineRevision: number;
	/** Stable firing identifier. */
	readonly firingId: string;
	/** Scheduled UTC slot, or null for a manual firing. */
	readonly scheduledSlot: string | null;
}

/** Durable workflow task identity. */
export interface RoutineRunProgressTask
{
	/** Workflow task identifier. */
	readonly taskId: string;
	/** Workflow definition name. */
	readonly taskName: string;
	/** Workflow idempotency key. */
	readonly idempotencyKey: string;
}

/** Historical Stop admission and terminal arbitration facts. */
export interface RoutineRunProgressCancellation
{
	/** Stop command identifier. */
	readonly commandId: string;
	/** Digest binding the command input. */
	readonly commandDigest: string;
	/** Bootstrap stream selected by the Stop command. */
	readonly bootstrapId: string;
	/** Terminal winner, or null before arbitration. */
	readonly decision: RoutineRunProgressCancellationDecisions | null;
	/** Time at which the terminal winner was recorded, or null before arbitration. */
	readonly decidedAt: string | null;
}

/** Model-neutral persisted cancellation winner values shared with the scheduling observer. */
export enum RoutineRunProgressCancellationDecisions
{
	/** Cancellation fenced final output before completion. */
	CancellationWon = "cancellation_won",
	/** Final output committed before cancellation could win. */
	OutputWon = "output_won",
}

/** Read-only routine progress projection. */
export interface RoutineRunProgressFactsRepository
{
	/** Read and validate historical routine evidence without admission or effect writes. */
	read(runId: string, attempt: number): Promise<RoutineRunProgressFacts | null>;
}
