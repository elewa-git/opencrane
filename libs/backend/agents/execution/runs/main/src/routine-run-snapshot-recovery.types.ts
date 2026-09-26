import type { RunInputSnapshot } from "@opencrane/contracts";

import type { RoutineRunAdmissionCommand } from "./run-admission.types";

/**
 * Reads the attempt-one snapshot of an already-admitted routine after matching its run, firing,
 * origin, subject, and digest. Missing or conflicting evidence never permits replacement work.
 */
export interface RoutineRunSnapshotRecovery
{
	/** Return the exact validated first snapshot, or null only when the expected run row is absent. */
	recover(command: RoutineRunAdmissionCommand, expectedAttempt: 1): Promise<RunInputSnapshot | null>;
}

/** Binds routine recovery reads to a caller-owned transaction. */
export type RoutineRunSnapshotRecoveryFactory<Transaction> = (transaction: Transaction) => RoutineRunSnapshotRecovery;
