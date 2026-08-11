import type { JsonValue } from "@opencrane/util";

import type { RuntimeTerminalReporter } from "./runtime-terminal-reporter.types.js";

/** Existing transaction shape owned by the run authority. */
type RuntimeEventTransaction = Parameters<RuntimeTerminalReporter["reportInTransaction"]>[0];

/** Already-fenced runtime event proposed to the canonical run stream. */
export interface RuntimeEventReportCommand
{
	/** Exact admitted run. */
	readonly runId: string;
	/** Exact current attempt. */
	readonly attempt: number;
	/** Untrusted event name that must match the canonical runtime vocabulary. */
	readonly eventType: string;
	/** Untrusted bounded JSON payload. */
	readonly payload: JsonValue;
}

/** Result of canonical event persistence. */
export type RuntimeEventReportResult = { readonly outcome: "reported" } | { readonly outcome: "denied"; readonly reason: "invalid_event" | "invalid_payload" | "run_not_assigned" | "run_not_running" | "conversation_unavailable" };

/** Transaction-scoped port from protocol admission to canonical run-event persistence. */
export interface RuntimeEventReporter
{
	/** Validate and persist before the caller appends candidate-id acceptance. */
	reportInTransaction(transaction: RuntimeEventTransaction, command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}

/** Repository used after payload validation to append one contiguous event. */
export interface RuntimeEventAppendRepository
{
	/** Append the canonical event under the caller-owned transaction and run fence. */
	append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}

/** Transaction binding that owns construction of the append repository. */
export interface RuntimeEventAppendUnitOfWork
{
	/** Append through the exact transaction-bound repository. */
	append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}
