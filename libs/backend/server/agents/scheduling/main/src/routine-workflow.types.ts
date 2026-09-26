import type { IWorkflowTaskDefinition, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { RoutineComputerActivationPort, RoutineComputerActivationReceipt, RoutineFiringIdentity, RoutineOccurrenceCommand, RoutineOccurrencePreparationPort, RoutineOccurrencePreparationReceipt, RoutineRunAdmissionPort } from "@opencrane/backend/server/agents/scheduling/contract";
import type { RoutineFiringDisposition } from "@opencrane/models/agents";

import type { RoutineIdFactory } from "./routine-authority.types";
import type { RoutineScheduleRepairPage, RoutineScheduleRepairPageResult } from "./routine-schedule-repair.types";
import type { RoutineInstructionCipher } from "./routine-instruction.types";
import type { RoutineInstructionEnvelope } from "./routine-instruction.types";

/** Consequential occurrence stages that each require a fresh transaction-bound authority fence. */
export enum RoutineOccurrenceStage
{
	/** Creates or recovers the independent occurrence conversation and history. */
	Preparation = "preparation",
	/** Activates or recovers the managed agent's computer. */
	Activation = "activation",
	/** Admits or recovers the exact root AgentRun. */
	RunAdmission = "run_admission",
}

/** Immutable input for one schedule wake task. */
export interface RoutineScheduleTaskInput
{
	/** Organisation that owns the routine. */
	readonly siloId: string;
	/** Stable routine whose next slot this task owns. */
	readonly routineId: string;
	/** Immutable revision whose schedule selected the slot. */
	readonly routineRevision: number;
	/** UTC slot at which the task may ask the database to select due work. */
	readonly slotEpochMs: number;
}

/** Immutable input for one occurrence preparation task. */
export interface RoutineOccurrenceTaskInput
{
	/** Organisation that owns the firing. */
	readonly siloId: string;
	/** Immutable occurrence to prepare and admit. */
	readonly firingId: string;
	/** Stable routine that owns the occurrence. */
	readonly routineId: string;
	/** Immutable routine revision selected for the occurrence. */
	readonly routineRevision: number;
}

/** Saved preparation input loaded under the occurrence task fence. */
export interface RoutineOccurrencePreparationInput extends RoutineOccurrenceCommand
{
	/** Encrypted instruction decrypted only by the workflow owner. */
	readonly instruction: RoutineInstructionEnvelope;
}

/** Exact linked-run progress saved by the future run-result adapter. */
export interface RoutineFiringProgressCommand
{
	/** Organisation that owns both firing and run. */
	readonly siloId: string;
	/** Immutable firing whose progress changes. */
	readonly firingId: string;
	/** Stable routine that owns the firing. */
	readonly routineId: string;
	/** Immutable routine revision used by the firing. */
	readonly routineRevision: number;
	/** Exact AgentRun already linked by admission. */
	readonly runId: string;
	/** New running, waiting, terminal, or uncertain disposition. */
	readonly disposition: RoutineFiringDisposition;
	/** First durable result or effect reference; every later progress event repeats it unchanged. */
	readonly resultReference: string | null;
	/** Digest paired with the first reference; the linked AgentRun remains the latest outcome owner. */
	readonly resultDigest: `sha256:${string}` | null;
}

/** Transaction-bound task admission supplied by server composition. */
export interface RoutineTaskAdmissionPort<Transaction>
{
	/** Admits or recovers one schedule-chain head through the caller's transaction. */
	admitSchedule(transaction: Transaction, input: RoutineScheduleTaskInput): Promise<IWorkflowTaskReceipt>;
	/** Admits or recovers one occurrence task through the caller's transaction. */
	admitOccurrence(transaction: Transaction, input: RoutineOccurrenceTaskInput): Promise<IWorkflowTaskReceipt>;
}

/** Persistence operations used by workflow handlers without importing runtime implementations. */
export interface RoutineWorkflowPersistence
{
	/** Re-admits one silo-scoped page of active schedule heads and returns its checked count plus continuation cursor; a full page must continue. */
	repairActiveSchedulesPage(page: RoutineScheduleRepairPage): Promise<RoutineScheduleRepairPageResult>;
	/** Selects the latest due automatic occurrence and admits its next durable tasks atomically. */
	fireAutomatic(command: import("./routine-authority.types").AutomaticRoutineFiringCommand): Promise<import("./routine-authority.types").RoutineFiringResult | null>;
	/** Rechecks current authority under the task fence or durably refuses the not-yet-admitted firing. */
	authorizeOccurrenceStage(identity: RoutineFiringIdentity, stage: RoutineOccurrenceStage): Promise<RoutineOccurrencePreparationInput | null>;
	/** Saves the first exact preparation receipt and returns the durable winner. */
	recordPreparation(identity: RoutineFiringIdentity, receipt: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrencePreparationReceipt>;
	/** Saves the first exact activation receipt and returns the durable winner. */
	recordActivation(identity: RoutineFiringIdentity, receipt: RoutineComputerActivationReceipt): Promise<RoutineComputerActivationReceipt>;
	/** Validates and binds the admitted run, including replay after admission committed its backlink. */
	bindAdmittedRun(identity: RoutineFiringIdentity, runId: string): Promise<void>;
	/** Saves linked-run progress while preserving the first evidence pair; AgentRun owns latest outcome. */
	recordRunProgress(command: RoutineFiringProgressCommand): Promise<void>;
}

/** Result of one automatic wake task after it advances or leaves the cursor. */
export interface RoutineScheduleTaskResult
{
	/** Firing created for the latest due slot, or null when no slot was due. */
	readonly firingId: string | null;
}

/** Result of one occurrence task after exact run admission succeeds. */
export interface RoutineOccurrenceTaskResult
{
	/** Immutable firing prepared by this task. */
	readonly firingId: string;
	/** Root AgentRun admitted for the firing, or null after a durable pre-admission refusal. */
	readonly runId: string | null;
}

/** Collaborators injected into the workflow definitions by server composition. */
export interface RoutineWorkflowDependencies
{
	/** Transactional firing and receipt authority. */
	readonly persistence: RoutineWorkflowPersistence;
	/** Mounted decryptor used outside every database transaction. */
	readonly cipher: RoutineInstructionCipher;
	/** External occurrence-history preparation port. */
	readonly preparation: RoutineOccurrencePreparationPort;
	/** External computer activation port. */
	readonly activation: RoutineComputerActivationPort;
	/** Shared root-run admission port. */
	readonly runAdmission: RoutineRunAdmissionPort;
	/** Opaque firing and occurrence-conversation identifiers. */
	readonly ids: RoutineIdFactory;
}

/** Pair of reviewed workflow handlers registered by server composition. */
export interface RoutineWorkflowDefinitions
{
	/** Sleeps durably until one schedule slot and selects current due work. */
	readonly schedule: IWorkflowTaskDefinition<RoutineScheduleTaskInput, RoutineScheduleTaskResult>;
	/** Prepares one occurrence and admits its exact root run. */
	readonly occurrence: IWorkflowTaskDefinition<RoutineOccurrenceTaskInput, RoutineOccurrenceTaskResult>;
}
