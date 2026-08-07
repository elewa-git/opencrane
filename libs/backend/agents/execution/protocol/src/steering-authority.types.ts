/** Disposition recorded for one ordered steering boundary. */
export type SteeringDisposition = "absorbed" | "deferred";

/** Pending steering observed at a safe pre-model boundary, or null when none is buffered. */
export interface PendingSteering
{
	/** Canonical digest of the buffered steering payload absorbed into the next model request. */
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

/** Immutable steering boundary the repository records exactly once. */
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

/** Persistence boundary that records exactly one disposition per steering boundary. */
export interface SteeringBoundaryRepository
{
	/** Atomically records a new boundary claim, or returns the disposition already recorded for it. */
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

/** Model terminal presented for admission against the attempt's current input generation. */
export interface AdmitModelTerminalCommand
{
	/** Input generation currently in force for the attempt. */
	readonly currentInputGeneration: number;
	/** Input generation the model terminal was produced under. */
	readonly terminalInputGeneration: number;
}

/** Whether a model terminal is admitted or rejected as produced against a superseded generation. */
export type AdmitModelTerminalResult =
	| { readonly outcome: "accepted" }
	| { readonly outcome: "rejected"; readonly reason: "stale_input_generation" };
