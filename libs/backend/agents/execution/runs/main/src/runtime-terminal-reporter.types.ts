import type { Prisma } from "@prisma/client";

/** Terminal runtime event types that an authenticated workload may propose. */
export type RuntimeTerminalEventType = "run.completed" | "run.failed";

/** A run's final result from the runtime, already checked against the fence, ready for the run authority. */
export interface RuntimeTerminalReportCommand
{
	/** Exact run whose authenticated workload proposed the terminal result. */
	readonly runId: string;
	/** Exact attempt bound to the authenticated workload assignment. */
	readonly attempt: number;
	/** Only success or runtime-failure may be proposed by the workload. */
	readonly eventType: RuntimeTerminalEventType;
}

/** Result of turning one admitted terminal runtime report into durable run evidence. */
export type RuntimeTerminalReportResult =
	| { readonly outcome: "reported" }
	| { readonly outcome: "denied"; readonly reason: "run_not_running" | "tool_results_pending" };

/**
 * How a workload's final result becomes the run's terminal state.
 *
 * Reached only for `run.completed` and `run.failed`, which are the only terminal events a
 * workload may propose — a workload can never report itself cancelled. The write happens on the
 * caller's transaction so the run's terminal state and the event that justifies it commit
 * together.
 *
 * Called by: `PrismaRuntimeEventReporter.reportInTransaction`, which routes the two terminal
 * event types here instead of appending them like ordinary events. Implemented by
 * `PrismaRuntimeTerminalReporter`.
 */
export interface RuntimeTerminalReporter
{
	/**
	 * Writes the run's terminal state from the workload's final report.
	 *
	 * @param transaction - The caller's open transaction, already holding the assignment and stream
	 * locks; this method must not open its own.
	 * @param command - The run, the attempt, and which of the two terminal outcomes was reported.
	 * @returns `reported` means the run is now Completed or Failed. `denied` with
	 * `run_not_running` means the run had already moved on, so the report is stale and must be
	 * dropped; `tool_results_pending` means tool work is still outstanding and the workload must not
	 * be treated as finished yet.
	 */
	reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeTerminalReportCommand): Promise<RuntimeTerminalReportResult>;
}

/** Transaction-bound read model for tool work that must finish before any runtime terminal report. */
export interface RuntimeTerminalPendingToolRepository
{
	/** Returns whether any invocation or undelivered result still stops the run from finishing. */
	hasPending(runId: string, attempt: number): Promise<boolean>;
}

/** Builds the pending-tool repository on the caller's transaction. */
export interface RuntimeTerminalPendingToolUnitOfWork extends RuntimeTerminalPendingToolRepository {}
