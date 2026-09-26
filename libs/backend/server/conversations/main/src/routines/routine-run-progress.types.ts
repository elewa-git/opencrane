import type { ConversationComputerStopAdmission, ConversationComputerStopPublishOutcome } from "../computers/interruptions/conversation-computer-stop.types";
import type { ConversationComputerToolResults } from "../computers/turns/conversation-computer-continuation.types";
import type { ConversationComputerTurnCandidateResolver } from "../computers/turns/conversation-computer-turn.types";
import type { FrozenConversationComputerTurn } from "../computers/turns/conversation-computer-turn.types";
import type { RoutineRunProgressObservation, RoutineRunProgressSink } from "@opencrane/backend/server/agents/scheduling/contract";

/** Exact frozen-turn coordinates used to reload producer-owned progress evidence. */
export type RoutineRunProgressTurn = Pick<FrozenConversationComputerTurn, "bootstrapId" | "siloId" | "computerId" | "lease" | "binding" | "latestPendingEntryId" | "compile">;

/** External protocol waits that may pause a routine without changing its AgentRun state. */
export enum RoutineRunProgressWaitKinds
{
	/** A participant must approve the exact selected tool invocation. */
	Approval = "approval",
	/** A captured file must finish promotion and scanning. */
	GeneratedFile = "generated_file",
}

/** Identifies the exact external wait whose start or clearance is being reported. */
export interface RoutineRunProgressWait
{
	readonly kind: RoutineRunProgressWaitKinds;
	readonly id: string;
}

/** Rechecks current turn authority and returns only a protocol-proven external wait. */
export interface RoutineRunProgressWaitEvidenceReader
{
	read(turn: FrozenConversationComputerTurn): Promise<RoutineRunProgressWait | null>;
}

/** Derives a scheduling observation only after checking the saved run and producer evidence. */
export interface RoutineRunProgressObserver
{
	/** Observe a checked Running run, including the initial no-op Running report. */
	observeRunning(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>;
	/** Observe a checked external wait while the run remains Running. */
	observeWaiting(turn: RoutineRunProgressTurn, wait: RoutineRunProgressWait): Promise<RoutineRunProgressObservation | null>;
	/** Observe the saved unavailable receipt after the run entered RecoveryRequired. */
	observeUnavailable(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>;
	/** Observe the saved assistant answer after the run completed. */
	observeCompleted(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>;
	/** Observe the SQL/Kurrent winner of a saved Stop admission. */
	observeStop(admission: Extract<ConversationComputerStopAdmission, { readonly target: unknown }>, outcome: ConversationComputerStopPublishOutcome): Promise<RoutineRunProgressObservation | null>;
}

/** Reports only semantic milestones whose saved source evidence determines the scheduling target. */
export interface RoutineRunProgressReporter
{
	/** Record a checked Running milestone; this also covers the initial Running no-op report. */
	recordRunning(turn: RoutineRunProgressTurn): Promise<void>;
	/** Record a checked routine turn before it enters a durable protocol wait. */
	recordWaiting(turn: RoutineRunProgressTurn, wait: RoutineRunProgressWait): Promise<void>;
	/** Record a saved unavailable receipt after the run entered RecoveryRequired. */
	recordUnavailable(turn: RoutineRunProgressTurn): Promise<void>;
	/** Record a saved answer after the run completed and before the turn settles. */
	recordCompleted(turn: RoutineRunProgressTurn): Promise<void>;
	/** Record the finalized terminal winner of a saved Stop admission. */
	recordStop(admission: Extract<ConversationComputerStopAdmission, { readonly target: unknown }>, outcome: ConversationComputerStopPublishOutcome): Promise<void>;
}

/** Dependencies used to recheck an external wait without advancing the turn. */
export interface RoutineRunProgressWaitEvidenceDependencies
{
	/** Rechecks the current lease and turn protocol before classifying a wait. */
	readonly candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrentForWorkflow">;
	/** Reads the saved tool result without dispatching or changing it. */
	readonly toolResults: Pick<ConversationComputerToolResults, "read">;
}

/** Dependencies of the acknowledgement-preserving progress reporter. */
export interface RoutineRunProgressReporterDependencies
{
	/** Produces a historical observation from the turn and its saved evidence. */
	readonly observer: RoutineRunProgressObserver;
	/** Persists the observation before the producer acknowledges its milestone. */
	readonly sink: RoutineRunProgressSink;
}
