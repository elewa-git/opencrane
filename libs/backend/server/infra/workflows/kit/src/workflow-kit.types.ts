import type { Logger } from "@opencrane/backend/observability";
import type { DurableExecution, DurableTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Names the minimum input that lets the kit identify the silo that owns a task.
 *
 * Called by: the Zod task-input parser. Product workflows add their own fields and validators;
 * this small shape keeps the shared kit independent of every product task schema.
 */
export interface IWorkflowSiloTaskInput
{
	/** Silo whose product state and task input this work may use. */
	readonly siloId: string;
}

/**
 * Connects one registered task name to the engine queue selected by application composition.
 *
 * Called by: {@link __CreateWorkflowTaskQueueAuthority}. Product domains use task names but never
 * choose a queue, so one reviewed authority must own this mapping.
 */
export interface IWorkflowTaskPolicy
{
	/** Registered task name that this policy governs. */
	readonly taskName: string;
	/** Engine queue that may dispatch this task. */
	readonly queue: string;
}

/**
 * Supplies the execution adapter and the fixed policy for one workflow-kit instance.
 *
 * Called by: {@link __CreateWorkflowKit}. One instance accepts only its configured `siloId`; this
 * prevents a correctly shaped task for another silo from reaching the selected engine adapter.
 */
export interface IWorkflowKitOptions
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
 *
 * Called by: the workflow kit's checkpoint wrapper.
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
