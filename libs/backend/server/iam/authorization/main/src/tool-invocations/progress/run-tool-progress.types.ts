import type { RunToolProgress } from "@opencrane/contracts";

/** Selects progress using server-derived coordinates from an already-authorized run read. */
export interface ReadRunToolProgressCommand
{
	/** Identifies the exact silo that owns the run. */
	readonly siloId: string;
	/** Identifies the run whose Read permission the caller already checked. */
	readonly runId: string;
	/** Identifies the current persisted attempt; old attempts must not contribute progress. */
	readonly attempt: number;
}

/** Reads phase-only progress inside the caller's existing authorization transaction. */
export interface RunToolProgressRepository
{
	/** Returns null only when this exact attempt has no governed run-owned invocation. */
	readLatest(command: ReadRunToolProgressCommand): Promise<RunToolProgress | null>;
}
