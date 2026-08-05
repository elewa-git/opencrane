import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

/** Session-derived owner identity for the self-only run status surface. */
export interface SelfRunStatusCaller
{
	/** Canonical silo selected from the trusted request host. */
	readonly siloId: string;
	/** Stable authenticated subject who owns the personal run. */
	readonly subjectId: string;
}

/** Persisted run fields safe to show to its owner. */
export interface SelfRunStatus
{
	/** Opaque canonical run identifier. */
	readonly runId: string;
	/** Current server-owned attempt number. */
	readonly attempt: number;
	/** Product lifecycle state. */
	readonly state: string;
	/** Linked conversation thread when the run began from one. */
	readonly threadId: string | null;
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
	listOwned(siloId: string, subjectId: string): Promise<readonly SelfRunStatus[]>;
	/** Returns the run only when it belongs to the exact authenticated subject in the silo. */
	readOwned(runId: string, siloId: string, subjectId: string): Promise<SelfRunStatus | null>;
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
