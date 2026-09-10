import type { ToolInvocationRecord, ToolResultDeliveryPayload } from "./tool-invocation.types";

/** Selects a result using coordinates derived from the server's saved run and tool proposal. */
export interface ReadRunToolResultCommand
{
	/** Limits the read to the installation that admitted the invocation. */
	readonly siloId: string;
	/** Identifies the run whose current attempt must still be Running. */
	readonly runId: string;
	/** Rejects results retained from a different attempt of the same run. */
	readonly attempt: number;
	/** Identifies the public tool call; this is not the delivery's internal foreign key. */
	readonly toolInvocationId: string;
	/** Binds the invocation to the admitted conversation computer. */
	readonly runtimeInstanceId: string;
	/** Binds the invocation to the saved command that admitted its proposal. */
	readonly commandId: string;
	/** Requires the immutable proposal fingerprint rather than trusting an identifier alone. */
	readonly requestFingerprint: string;
}

/** Identifies the immutable result already retained by the caller's durable continuation. */
export interface ConsumeRunToolResultCommand extends ReadRunToolResultCommand
{
	/** Must equal both the stored delivery digest and the caller's saved continuation result digest. */
	readonly payloadDigest: string;
}

/**
 * Reports whether a matching invocation has a usable result, without acknowledging its delivery.
 * These closed in-process outcomes grant no current participant, lease or tool permission.
 * The caller must check that authority in the same transaction before using Available content.
 */
export enum RunToolResultReadOutcomes
{
	/** Matching work is still preparing, awaiting approval, ready, claimed or reconciling. */
	Pending = "pending",
	/** A terminal invocation and its exact delivery agree; the caller must still authorize use. */
	Available = "available",
	/** Coordinates, current run state or stored result evidence do not permit a usable read. */
	Unavailable = "unavailable",
}

/** Identifies the durable wake that can make a pending invocation progress. */
export enum RunToolResultPendingKinds
{
	/** An owner decision must move the invocation to Ready or Failed. */
	Approval = "approval",
	/** An executor result event must complete the already-admitted invocation. */
	Execution = "execution",
}

/** Keeps result content out of pending or unavailable outcomes. */
export type ReadRunToolResultResult =
	| { readonly outcome: RunToolResultReadOutcomes.Pending | RunToolResultReadOutcomes.Unavailable; readonly pendingKind?: RunToolResultPendingKinds; readonly pendingUntilEpochMs?: number }
	| {
		/** Confirms storage integrity, not permission to disclose or dispatch. */
		readonly outcome: RunToolResultReadOutcomes.Available;
		/** Supplies the existing server-only record for the caller's current-authority check. */
		readonly invocation: ToolInvocationRecord;
		/** Contains a detached copy matching the immutable terminal invocation. */
		readonly payload: ToolResultDeliveryPayload;
		/** Binds the entire canonical payload for a later durable continuation. */
		readonly payloadDigest: string;
		/** Reports existing acknowledgement state without changing it or hiding consumed results. */
		readonly consumed: boolean;
	};

/** Keeps exact result reads and acknowledgement within one already-open product transaction. */
export interface RunToolResultDeliveryRepository
{
	/** Returns matching terminal evidence without granting permission or changing delivery state. */
	read(command: ReadRunToolResultCommand): Promise<ReadRunToolResultResult>;
	/** Acknowledges an already-retained result after the caller's durable and current-authority checks. */
	consume(command: ConsumeRunToolResultCommand, now: Date): Promise<ReadRunToolResultResult>;
}
