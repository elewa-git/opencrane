import type { AgUiToolRecoveryRequiredEnvelope, SafeToolTechnicalDetails } from "@opencrane/contracts";

/**
 * How a single tool call is going.
 *
 * `Recovered` and `Completed` both mean the call ended successfully, but `Recovered` says it failed
 * at least once first, and those earlier failures are still listed in `failures` — a UI that hides
 * them loses the only record. `NeedsRecovery` means the action must not be dispatched again.
 *
 * @see AgUiToolView
 * @see AgUiRunStatuses
 */
export enum AgUiToolStatuses
{
	/** The tool call was requested and may still progress. */
	Requested = "requested",
	/** The authoritative stream reported successful completion. */
	Completed = "completed",
	/** The authoritative stream reported a failure, including before later model recovery. */
	Failed = "failed",
	/** The action outcome is ambiguous and must not be dispatched again. */
	NeedsRecovery = "needs_recovery",
	/** The tool later completed, while retaining the earlier visible failure evidence. */
	Recovered = "recovered",
}

/** One recorded failure of a tool call, kept even after a later attempt succeeds. */
export interface AgUiToolFailure
{
	/** Optional server-selected technical classification for this failed attempt. */
	readonly code: string | null;
	/** Whether the control plane will retry after this visible failed attempt. */
	readonly retrying: boolean;
	/** Provider-free details shown only after the user opens technical disclosure. */
	readonly technicalDetails: SafeToolTechnicalDetails;
}

/** One tool call, assembled in the browser from the stream's tool events. */
export interface AgUiToolView
{
	/** Stable tool-call identifier. */
	readonly id: string;
	/** Display-safe tool name. */
	readonly name: string;
	/** The tool's arguments as JSON text, appended delta by delta; may be incomplete while streaming. */
	readonly arguments: string;
	/** Truthful projected tool lifecycle. */
	readonly status: AgUiToolStatuses;
	/** Display-safe tool result, when emitted. */
	readonly result: string | null;
	/** Optional server-selected technical classification for a failure. */
	readonly failureCode: string | null;
	/** Every failure so far, in order; kept even after a later attempt recovers. */
	readonly failures: readonly AgUiToolFailure[];
	/** Recovery details safe to show, kept after the run is cancelled or reconciled. */
	readonly recovery: AgUiToolRecoveryRequiredEnvelope | null;
}
