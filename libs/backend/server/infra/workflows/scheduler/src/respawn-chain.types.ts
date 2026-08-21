import { DurableTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableExecution, DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/** The transaction-bound caller context required by every durable task spawn. */
export type RespawnChainTransaction = Parameters<DurableExecution["spawn"]>[0];

/**
 * Supplies the completion evidence required before a recurrence can admit its next task.
 *
 * The scheduler accepts only {@link DurableTaskStates.Completed}; failed or cancelled work cannot
 * create another slot. This prevents a retry or cancellation from silently continuing a product
 * recurrence.
 */
export interface CompletedRespawnIteration
{
	/** Durable task identifier recorded by the workflow engine. */
	readonly taskId: string;
	/** The deterministic slot key that identified the completed task. */
	readonly slotKey: string;
	/** Completion is the sole terminal state that may create a successor. */
	readonly state: DurableTaskStates.Completed;
}

/** The task details the scheduler supplies without interpreting the task's domain input. */
export interface RespawnChainTask
{
	/** Registered durable task handler to execute. */
	readonly taskName: string;
	/** Opaque handler input preserved by this scheduling helper. */
	readonly input: unknown;
}

/** Request to make sure one chain has a task for its current head slot. */
export interface EnsureRespawnChainHeadCommand extends RespawnChainTask
{
	/** Transaction that owns both the caller's product write and this task admission. */
	readonly transaction: RespawnChainTransaction;
	/** Stable identity of the recurrence, chosen by its owning domain. */
	readonly chainKey: string;
	/** Deterministic identity of the current slot, chosen by the scheduler owner. */
	readonly slotKey: string;
}

/** Request to create the next fresh task after an iteration has completed. */
export interface SpawnRespawnChainSuccessorCommand extends RespawnChainTask
{
	/** Transaction that owns this successor admission. */
	readonly transaction: RespawnChainTransaction;
	/** Stable identity shared by every task in this recurrence. */
	readonly chainKey: string;
	/** Durable completion evidence for the task that is allowed to continue the chain. */
	readonly completed: CompletedRespawnIteration;
	/** Deterministic identity of the next slot; it must differ from `completed.slotKey`. */
	readonly nextSlotKey: string;
}

/** The engine receipt together with the stable key used to deduplicate this chain slot. */
export interface RespawnChainSpawn
{
	/** Deterministic engine idempotency key for this chain and slot. */
	readonly taskKey: string;
	/** Engine-owned receipt for the admitted or pre-existing task. */
	readonly receipt: DurableTaskReceipt;
}
