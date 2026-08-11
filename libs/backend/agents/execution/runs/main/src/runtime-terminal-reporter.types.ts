import type { Prisma } from "@prisma/client";

/** Terminal runtime event types that an authenticated workload may propose. */
export type RuntimeTerminalEventType = "run.completed" | "run.failed";

/** Immutable, already-fenced runtime terminal report handed to the run authority. */
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

/** Transaction-scoped port from the protocol fence to the canonical run authority. */
export interface RuntimeTerminalReporter
{
	/** Persist one terminal report inside the caller's assignment-and-stream transaction. */
	reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeTerminalReportCommand): Promise<RuntimeTerminalReportResult>;
}

/** Transaction-bound read model for tool work that must finish before run completion. */
export interface RuntimeTerminalPendingToolRepository
{
	/** Return whether any invocation or undelivered result still blocks successful completion. */
	hasPending(runId: string, attempt: number): Promise<boolean>;
}

/** Transaction owner that constructs the pending-tool repository. */
export interface RuntimeTerminalPendingToolUnitOfWork extends RuntimeTerminalPendingToolRepository {}
