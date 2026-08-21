import type { Logger } from "@opencrane/backend/observability";
import type { DurableExecution, DurableTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";

/** JSON-shaped task input that identifies the silo that owns the work. */
export interface WorkflowSiloTaskInput
{
	/** Silo whose product state and task input this work may use. */
	readonly siloId: string;
}

/** One task name and the engine queue that application composition assigns to it. */
export interface WorkflowTaskPolicy
{
	/** Registered task name that this policy governs. */
	readonly taskName: string;
	/** Engine queue that may dispatch this task. */
	readonly queue: string;
}

/** Dependencies and policy that bind one kit instance to a single silo. */
export interface WorkflowKitOptions
{
	/** Engine-neutral durable execution port that stores and dispatches the tasks. */
	readonly execution: DurableExecution;
	/** Silo that this kit accepts in every admitted task payload. */
	readonly siloId: string;
	/** Immutable reviewed queue authority shared with the selected engine adapter. */
	readonly queueAuthority: DurableTaskQueueAuthority;
	/** Structured logger used only with the kit's payload-free diagnostic fields. */
	readonly log?: Logger;
}

/**
 * Labels the result that workflow telemetry reports for a checkpoint.
 *
 * `Completed` means the operation ran and returned, `Replayed` means the engine returned a saved
 * checkpoint without running it again, and `Failed` means the operation or its context failed.
 * The kit writes these values to the trace and structured log so operators can distinguish a
 * replay from new work.
 */
export enum WorkflowStepOutcomes
{
	/** The engine executed the checkpoint operation and it returned successfully. */
	Completed = "completed",
	/** The engine returned a previously recorded checkpoint result without running the operation. */
	Replayed = "replayed",
	/** The checkpoint operation or engine context failed. */
	Failed = "failed",
}
