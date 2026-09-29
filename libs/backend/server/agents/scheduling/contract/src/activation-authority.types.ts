import type { RoutineComputerActivationReceipt, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "./routine-occurrence.types";

/** Distinguishes first activation from recovery of an exact saved activation receipt. */
export interface RoutineOccurrenceActivationAuthorization
{
	/** Saved activation receipt, or null when the caller may activate for the first time. */
	readonly activation: RoutineComputerActivationReceipt | null;
}

/**
 * Keeps firing authority with scheduling while the computer owner supplies the transaction.
 * Current activation authority and the exact preparation receipt are checked on every poll,
 * including recovery of a saved activation receipt.
 */
export interface RoutineOccurrenceActivationRepository
{
	/**
	 * Rechecks the immutable firing, saved preparation and current activation authority.
	 * Null means the firing is durably Refused. A saved activation permits exact recovery only.
	 */
	authorize(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrenceActivationAuthorization | null>;
	/** Records or recovers the exact activation receipt under the preparing, unadmitted firing fence. */
	record(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt, receipt: RoutineComputerActivationReceipt): Promise<RoutineComputerActivationReceipt>;
	/** Durably refuses the preparing, unadmitted firing without discarding earlier stage receipts. */
	refuse(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt): Promise<void>;
}

/** Builds a scheduling-owned activation repository over a caller-supplied transaction. */
export type RoutineOccurrenceActivationRepositoryFactory<Transaction> = (transaction: Transaction) => RoutineOccurrenceActivationRepository;
