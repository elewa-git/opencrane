import type { RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "./routine-occurrence.types";

/** Original payer fields handed directly from routine persistence to conversation preparation. */
export interface RoutineOccurrencePreparationPayer
{
	/** Group selected when the requester created the routine. */
	readonly payingGroupId: string;
	/** Digest of the selection's recorded authorization decision. */
	readonly decisionDigest: `sha256:${string}`;
	/** Digest of the policy catalogue used by that decision. */
	readonly policyRevisionHash: `sha256:${string}`;
	/** Digest of the current grants that allowed the selection. */
	readonly effectiveAuthorizationDigest: `sha256:${string}`;
}

/** Distinguishes a fresh authorized publication from an already committed preparation. */
export interface RoutineOccurrencePreparationAuthorization
{
	/** Original payer tuple copied to the hidden occurrence conversation without entering history. */
	readonly payer: RoutineOccurrencePreparationPayer;
	/** Saved publication marker, or null when the caller may publish for the first time. */
	readonly preparation: RoutineOccurrencePreparationReceipt | null;
}

/**
 * Keeps firing authority with scheduling while the conversation owner supplies the transaction.
 * Final authority checks, participants, grants and the preparation receipt must commit together.
 * A refusal must commit without publishing new access; a saved receipt never authorizes regranting it.
 */
export interface RoutineOccurrencePreparationRepository
{
	/**
	 * Checks persisted occurrence facts and current authority. Null means the firing is already Refused
	 * or has been marked Refused in this transaction; the caller must commit that refusal without publishing.
	 * A non-null result with null preparation permits first publication. A saved receipt permits recovery
	 * only, without restoring access. Conflicting saved facts throw and require rollback.
	 */
	authorize(command: RoutineOccurrenceCommand): Promise<RoutineOccurrencePreparationAuthorization | null>;
	/** Saves the exact publication marker under the same command and no-run fence in the publication transaction. */
	record(command: RoutineOccurrenceCommand, receipt: RoutineOccurrencePreparationReceipt): Promise<RoutineOccurrencePreparationReceipt>;
	/** Durably refuses fresh preparation in the caller's transaction when its external execution facts are no longer eligible. */
	refuse(command: RoutineOccurrenceCommand): Promise<void>;
}

/** Builds a scheduling-owned preparation repository over a caller-supplied transaction. */
export type RoutineOccurrencePreparationRepositoryFactory<Transaction> = (transaction: Transaction) => RoutineOccurrencePreparationRepository;
