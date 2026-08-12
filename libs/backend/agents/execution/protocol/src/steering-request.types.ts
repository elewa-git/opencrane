import type { JsonValue } from "@opencrane/util";

/** Request to queue one owner's instruction for the run's current attempt. Only the text comes from the caller. */
export interface SubmitSteeringRequestCommand
{
	/** Run named in the request path. */
	readonly runId: string;
	/** Silo resolved from the authenticated request host. */
	readonly siloId: string;
	/** Stable authenticated subject that must own the run. */
	readonly subjectId: string;
	/** Bounded JSON instruction accepted from the owner. */
	readonly content: JsonValue;
	/** Server-computed canonical digest of the accepted instruction. */
	readonly digest: string;
	/** Trusted submission instant. */
	readonly submittedAt: Date;
}

/** Stable result of attempting to queue steering for the live run attempt. */
export type SubmitSteeringRequestResult =
	| { readonly outcome: "queued"; readonly steeringRequestId: string; readonly attempt: number }
	| { readonly outcome: "not_found_or_not_owner" }
	| { readonly outcome: "run_not_steerable" };

/**
 * Saves owner-submitted steering, in one transaction.
 *
 * Ownership and steerability are checked in the same transaction as the insert, under the run's
 * lock, because both can change between an HTTP request arriving and the row being written. Doing
 * it in one step is what stops a run being steered by someone who no longer owns it.
 *
 * Called by: `__CreateSteeringIngestRouter` (steering-ingest.router.ts) through its injected
 * `requests` port. Implemented by `PrismaSteeringRequestRepository`.
 */
export interface SteeringRequestRepository
{
	/**
	 * Queue one instruction for the signed-in owner's current attempt.
	 *
	 * @param command - The run, silo, subject, instruction, digest, and submission time.
	 * @returns `queued` with the new id and attempt - answer 202. `not_found_or_not_owner` - answer 404
	 * and say nothing more, so the endpoint cannot be used to discover other people's runs.
	 * `run_not_steerable` - answer 409: the run exists and is owned by the caller, but it is not in a
	 * steerable state, or a resume command has already been sent for this attempt and steering can no
	 * longer be folded in.
	 */
	submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>;
}
