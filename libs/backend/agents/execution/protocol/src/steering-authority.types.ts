/**
 * What one steering boundary decided: the waiting instruction was taken, or there was none.
 *
 * These are not interchangeable labels. `absorbed` means the instruction is now part of the next
 * model request and the attempt's input generation has moved on by one, which is what makes any
 * model output produced under the old generation stale. `deferred` means nothing was waiting and the
 * generation is unchanged. A caller that treats a deferral as an absorb would advance the generation
 * with no instruction to show for it, and then reject the next legitimate model result as stale.
 *
 * @see __ClaimSteeringBoundary which records one.
 * @see __AdmitModelTerminal which rejects output produced under a superseded generation.
 */
export type SteeringDisposition = "absorbed" | "deferred";

/** Steering waiting to be applied at the next boundary, or null when nothing is waiting. */
export interface PendingSteering
{
	/** Digest of the waiting steering text that goes into the next model request. */
	readonly steeringDigest: string;
}

/** Request to claim the next ordered steering boundary for one attempt. */
export interface ClaimSteeringBoundaryCommand
{
	/** Logical run whose steering ordering is advancing. */
	readonly runId: string;
	/** Current positive attempt. */
	readonly attempt: number;
	/** Input generation the runtime is about to issue a model request from. */
	readonly fromInputGeneration: number;
	/** Buffered steering absorbed at this boundary, or null to record a deferral. */
	readonly pendingSteering: PendingSteering | null;
}

/** One steering boundary, written to the database exactly once. */
export interface SteeringBoundaryClaim
{
	/** Logical run the boundary belongs to. */
	readonly runId: string;
	/** Attempt the boundary belongs to. */
	readonly attempt: number;
	/** Deterministic boundary identifier derived from the run, attempt, and source generation. */
	readonly boundaryId: string;
	/** Input generation the boundary advanced from. */
	readonly fromInputGeneration: number;
	/** Input generation in force after the boundary; advanced by one only when steering is absorbed. */
	readonly toInputGeneration: number;
	/** Disposition fixed for the boundary. */
	readonly disposition: SteeringDisposition;
	/** Digest of the absorbed steering payload, or null for a deferral. */
	readonly steeringDigest: string | null;
}

/** Atomic result of recording one steering boundary claim. */
export type SteeringBoundaryClaimResult =
	| { readonly status: "claimed" }
	| { readonly status: "existing"; readonly disposition: SteeringDisposition; readonly toInputGeneration: number; readonly steeringDigest: string | null };

/**
 * Records one absorbed-or-deferred decision per steering boundary, and only ever one.
 *
 * The exactly-once promise is the whole point: a process can die between deciding and acknowledging,
 * and the runtime will then claim the same boundary again. The implementation answers that by
 * returning the decision already recorded rather than writing a second one, so an instruction is
 * never applied twice.
 *
 * Called by: `__ClaimSteeringBoundary` (steering-authority.ts). Implemented by
 * `PrismaSteeringBoundaryRepository`; no other implementation exists.
 */
export interface SteeringBoundaryRepository
{
	/**
	 * Record a new boundary, or report the decision already recorded for it.
	 *
	 * @param claim - The boundary to record, identified by its deterministic id.
	 * @returns `claimed` - this call recorded the decision, so the caller's own disposition and
	 * generation are in force. `existing` - an earlier process already recorded one, and the caller must
	 * use the returned disposition and generation instead of its own, or steering would be applied
	 * twice.
	 * @throws {Error} When a boundary that absorbed steering could not move the attempt's input
	 * generation by exactly one row, which would leave the boundary and the command stream disagreeing.
	 */
	claim(claim: SteeringBoundaryClaim): Promise<SteeringBoundaryClaimResult>;
}

/** Result of claiming one ordered steering boundary. */
export interface ClaimSteeringBoundaryResult
{
	/** Deterministic identifier of the claimed boundary. */
	readonly boundaryId: string;
	/** Disposition in force for the boundary, whether freshly claimed or replayed. */
	readonly disposition: SteeringDisposition;
	/** Input generation in force after the boundary. */
	readonly toInputGeneration: number;
	/** Whether a prior process already recorded this exact boundary before the current claim. */
	readonly replayed: boolean;
}

/** A finished model response, being checked against the attempt's current input generation. */
export interface AdmitModelTerminalCommand
{
	/** Input generation currently in force for the attempt. */
	readonly currentInputGeneration: number;
	/** Input generation the model terminal was produced under. */
	readonly terminalInputGeneration: number;
}

/** Accepted, or rejected because the response was produced against an older input generation. */
export type AdmitModelTerminalResult =
	| { readonly outcome: "accepted" }
	| { readonly outcome: "rejected"; readonly reason: "stale_input_generation" };
