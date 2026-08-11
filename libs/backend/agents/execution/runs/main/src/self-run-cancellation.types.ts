import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

/** Stable outcomes returned by the owner-bound cancellation use case. */
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
