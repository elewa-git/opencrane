import type { RunAdmissionBuild, RunAdmissionCommand, RunAdmissionResult } from "./run-admission.types";

/**
 * Restricts run-admission persistence to an already open product transaction.
 *
 * Called by: `PrismaRunAdmissionUnitOfWork` for initial writes and idempotent recovery.
 * @see RunAdmissionRepository for the transaction-owning public boundary.
 */
export interface RunAdmissionPersistenceRepository
{
	/** Resolve the exact immutable admission already stored under this command's idempotency key. */
	resolveExisting(command: RunAdmissionCommand): Promise<RunAdmissionResult<never> | null>;
	/** Insert the run and its first immutable snapshot inside the caller-owned transaction. */
	persist(command: RunAdmissionCommand, value: RunAdmissionBuild, admittedAt: Date): Promise<void>;
}
