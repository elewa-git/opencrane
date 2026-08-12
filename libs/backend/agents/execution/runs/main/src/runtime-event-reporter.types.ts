import type { JsonValue } from "@opencrane/util";

import type { RuntimeTerminalReporter } from "./runtime-terminal-reporter.types.js";

/** Existing transaction shape owned by the run authority. */
type RuntimeEventTransaction = Parameters<RuntimeTerminalReporter["reportInTransaction"]>[0];

/** An event the runtime proposes for the run's event stream, already checked against the fence. */
export interface RuntimeEventReportCommand
{
	/** The run this event belongs to. */
	readonly runId: string;
	/** The attempt this event belongs to. */
	readonly attempt: number;
	/** Event name from the runtime; it must match one of the allowed names. */
	readonly eventType: string;
	/** Untrusted bounded JSON payload. */
	readonly payload: JsonValue;
}

/**
 * Whether the proposed run event was written, and why it was refused.
 *
 * Every refusal is the runtime's problem to handle, not a server fault: `invalid_event` and
 * `invalid_payload` mean the workload sent something outside the contract and will keep failing
 * until it changes; `run_not_assigned` and `run_not_running` mean the run has moved on, so the
 * workload should stop rather than retry; `conversation_unavailable` means this event type has
 * nowhere to go on a run with no conversation; `tool_results_pending` means tool work must finish
 * before this event can be accepted. A caller must refuse the whole candidate on any of them —
 * never write the event some other way.
 */
export type RuntimeEventReportResult = { readonly outcome: "reported" } | { readonly outcome: "denied"; readonly reason: "invalid_event" | "invalid_payload" | "run_not_assigned" | "run_not_running" | "conversation_unavailable" | "tool_results_pending" };

/**
 * How the runtime protocol writes a run event without owning run persistence.
 *
 * The protocol package admits a candidate and needs the resulting event stored in the very same
 * transaction, so that an accepted candidate id and its event can never disagree. This port is
 * that seam, and it is why the protocol never imports run persistence directly.
 *
 * Called by: `_ApplyRuntimeCandidateSideEffects` in
 * `execution/protocol/src/prisma-runtime-candidate-side-effects.ts`, reached from
 * `PrismaRuntimeDispatchAuthority.__AdmitCandidate`. Implemented by
 * `PrismaRuntimeEventReporter`; wired in `execution/protocol/src/production-runtime-dispatch.ts`.
 */
export interface RuntimeEventReporter
{
	/**
	 * Validates the runtime's proposed event and writes it on the caller's transaction.
	 *
	 * Must be called before the caller records the candidate id as accepted, so a rolled-back event
	 * can never leave an accepted id behind.
	 *
	 * @param transaction - The caller's open transaction; this method must not open its own.
	 * @param command - The untrusted event name and payload, plus the run and attempt it claims.
	 * @returns `reported` means the event is durable within the caller's transaction. `denied`
	 * carries a reason the caller must turn into a refusal of the whole candidate.
	 */
	reportInTransaction(transaction: RuntimeEventTransaction, command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}

/** Repository used after payload validation to append one contiguous event. */
export interface RuntimeEventAppendRepository
{
	/** Append the canonical event under the caller-owned transaction and run fence. */
	append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}

/** Builds the append repository on the caller's transaction. */
export interface RuntimeEventAppendUnitOfWork
{
	/** Appends the event through that transaction's repository. */
	append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>;
}
