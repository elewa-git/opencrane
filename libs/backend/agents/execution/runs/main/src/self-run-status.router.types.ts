import type { Request } from "express";
import type { RunToolProgress } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";

/** Session-derived owner identity for the self-only run status surface. */
export interface SelfRunStatusCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Durable local Principal used by central product authorization. */
	readonly principalId: string;
}

/**
 * Stable lifecycle states exposed by the owner-only run status API.
 *
 * These serialized values are part of the public HTTP contract. Renaming one is a breaking API change.
 */
export enum SelfRunStates
{
	/** The authority accepted the run. */
	Accepted = "accepted",
	/** Durable dispatch is waiting for a worker. */
	Queued = "queued",
	/** A worker assignment exists. */
	Assigned = "assigned",
	/** The current attempt may progress. */
	Running = "running",
	/** The run awaits participant input. */
	WaitingForInput = "waiting_for_input",
	/** A provider outcome requires explicit recovery. */
	RecoveryRequired = "recovery_required",
	/** A Stop command won admission and awaits terminal arbitration or cleanup. */
	Cancelling = "cancelling",
	/** Requester-authorized cancellation completed. */
	Cancelled = "cancelled",
	/** The run completed successfully. */
	Completed = "completed",
	/** The run ended with a definite failure. */
	Failed = "failed",
}

/** Persisted run fields safe to show to its owner. */
export interface SelfRunStatus
{
	/** Opaque canonical run identifier. */
	readonly runId: string;
	/** Current server-owned attempt number. */
	readonly attempt: number;
	/** Product lifecycle state. */
	readonly state: SelfRunStates;
	/** Latest tool phase in this attempt; null means no invocation, not a failed read. */
	readonly latestTool: RunToolProgress | null;
	/** Linked conversation conversation when the run began from one. */
	readonly conversationId: string | null;
	/** Immutable revision selected when the run was accepted. */
	readonly agentRevisionId: string;
	/** Server acceptance time. */
	readonly acceptedAt: string;
	/** Terminal completion time, when finished. */
	readonly finishedAt: string | null;
}

/** Read-only owner-bound persistence port for one run status. */
export interface SelfRunStatusRepository
{
	/** Lists the caller's most recent personal runs in one exact selected silo. */
	listOwned(caller: SelfRunStatusCaller): Promise<readonly SelfRunStatus[]>;
	/** Returns the run only when it belongs to the exact authenticated principal in the silo. */
	readOwned(caller: SelfRunStatusCaller, runId: string): Promise<SelfRunStatus | null>;
}

/** Composition ports for the authenticated self-run status route. */
export interface SelfRunStatusRouterDependencies
{
	/** Resolves server-derived browser identity. */
	resolveCaller(request: Request): SelfRunStatusCaller | null;
	/** Reads only the caller-owned run. */
	repository: SelfRunStatusRepository;
	/** Records unexpected read failures without run data. */
	logger: Logger;
}
