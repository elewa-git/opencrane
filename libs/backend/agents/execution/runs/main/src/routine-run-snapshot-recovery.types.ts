import type { RunInputSnapshot } from "@opencrane/contracts";

import type { RoutineRunAdmissionCommand, RunAdmissionPayer } from "./run-admission.types";

/** Exact saved payer and snapshot returned for a previously admitted routine run. */
export interface RoutineRunSnapshotRecoveryResult
{
	/** Original payer tuple persisted on the managed AgentRun. */
	readonly payer: RunAdmissionPayer;
	/** Immutable first-attempt run input. */
	readonly snapshot: RunInputSnapshot;
}

/**
 * Reads the attempt-one snapshot of an already-admitted routine after matching its run, firing,
 * origin, subject, and digest. Missing or conflicting evidence never permits replacement work.
 */
export interface RoutineRunSnapshotRecovery
{
	/** Return the exact validated first snapshot, or null only when the expected run row is absent. */
	recover(command: RoutineRunAdmissionCommand, expectedAttempt: 1): Promise<RoutineRunSnapshotRecoveryResult | null>;
}

/** Binds routine recovery reads to a caller-owned transaction. */
export type RoutineRunSnapshotRecoveryFactory<Transaction> = (transaction: Transaction) => RoutineRunSnapshotRecovery;
