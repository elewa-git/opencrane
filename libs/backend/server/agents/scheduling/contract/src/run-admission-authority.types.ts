import type { RoutineRunAdmissionInput } from "./routine-occurrence.types";

/**
 * Keeps the final scheduling check in the root-run owner's transaction. This authority can refuse
 * an unadmitted firing, but it never creates, replaces, or overwrites an admitted run.
 */
export interface RoutineOccurrenceRunAdmissionRepository
{
	/** Checks the saved command and both receipts, then rechecks current run-stage authority. */
	authorize(command: RoutineRunAdmissionInput): Promise<boolean>;
	/** Confirms both saved receipts still belong to the existing run; this cannot admit new work. */
	recover(command: RoutineRunAdmissionInput, runId: string): Promise<boolean>;
	/** Refuses an unadmitted firing after a definite denial; returns false if a run already exists. */
	refuse(command: RoutineRunAdmissionInput): Promise<boolean>;
}

/** Builds the scheduling guard against the transaction chosen by the run owner. */
export type RoutineOccurrenceRunAdmissionRepositoryFactory<Transaction> = (transaction: Transaction) => RoutineOccurrenceRunAdmissionRepository;
