import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

/**
 * What the owner is told when they cancel their own run, and what each outcome really means.
 *
 * Cancelling a run is two separate steps: fence the active attempt, then let its saved workflow
 * remove the exact warm Pod and finish output handling. `Cancelling` means the first step is done
 * and workflow cleanup is still owed. `Cancelled` means both are done and nothing remains active.
 * A caller that treats them as the same thing can tell the user a run has stopped before cleanup
 * has actually finished.
 *
 * `NotFound` deliberately covers both "no such run" and "not your run", so a caller cannot probe
 * for other owners' runs. `AttemptConflict` means the browser was looking at an older attempt and
 * should re-read before showing anything; `TerminalRun` means the run had already finished, so
 * there is nothing to cancel. `AuthorityConflict` means the write could not be applied safely and
 * `InvalidRequest` means the coordinates were rejected before any write was attempted.
 */
export enum SelfRunCancellationOutcomes
{
	/** The run is fenced and physical workload cleanup is still completing. */
	Cancelling = "cancelling",
	/** The run is fully cancelled and no physical cleanup remains. */
	Cancelled = "cancelled",
	/** The run is absent or belongs to another owner. */
	NotFound = "not_found",
	/** The browser observed an older attempt than the server now owns. */
	AttemptConflict = "attempt_conflict",
	/** The run already finished and cannot be cancelled. */
	TerminalRun = "terminal_run",
	/** Durable authority could not safely apply the cancellation. */
	AuthorityConflict = "authority_conflict",
	/** The cancellation coordinates failed domain validation. */
	InvalidRequest = "invalid_request",
}

/** Session-derived owner identity for the self-only cancellation surface. */
export interface SelfRunCancellationCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject who owns the personal run. */
	readonly subjectId: string;
}

/** Owner-bound request to cancel one exact run attempt. */
export interface SelfRunCancellationCommand extends SelfRunCancellationCaller
{
	/** Opaque canonical run identifier selected from the route. */
	readonly runId: string;
	/** Attempt observed by the browser; stale observations cannot cancel newer work. */
	readonly expectedAttempt: number;
}

/** Successful owner-bound cancellation result. */
export interface SelfRunCancellationSuccess
{
	/** Whether cleanup is still running or cancellation is already final. */
	readonly outcome: SelfRunCancellationOutcomes.Cancelling | SelfRunCancellationOutcomes.Cancelled;
	/** Opaque canonical run identifier. */
	readonly runId: string;
	/** Exact attempt fenced by the cancellation authority. */
	readonly attempt: number;
}

/** Owner-bound cancellation result that does not expose foreign run state. */
export type SelfRunCancellationResult = SelfRunCancellationSuccess | { readonly outcome: Exclude<SelfRunCancellationOutcomes, SelfRunCancellationOutcomes.Cancelling | SelfRunCancellationOutcomes.Cancelled> };

/** Persistence boundary that hides foreign runs before invoking cancellation authority. */
export interface SelfRunCancellationRepository
{
	/** Request cancellation only when the exact session subject owns the run in the selected silo. */
	requestOwned(command: SelfRunCancellationCommand): Promise<SelfRunCancellationResult>;
}

/** Exact accepted request body after strict transport validation. */
export interface SelfRunCancellationBody
{
	/** Attempt observed by the browser. */
	readonly expectedAttempt: number;
}

/** Composition ports for the authenticated self-run cancellation route. */
export interface SelfRunCancellationRouterDependencies
{
	/** Resolves server-derived browser identity. */
	resolveCaller(request: Request): SelfRunCancellationCaller | null;
	/** Cancels only runs owned by that identity. */
	cancellation: SelfRunCancellationRepository;
	/** Records unexpected failures without request or provider data. */
	logger: Logger;
}
