import type { AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import type { RunAdmissionCommand, RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import type { ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

/**
 * Limits how many run admissions may be in flight at once, checked before admission touches the
 * database.
 *
 * Three limits nested inside each other: process-wide, then per silo, then per AgentService. The
 * point of the process-wide one is the database: admission opens a serializable transaction, and
 * the connection pool is small, so an unbounded burst would starve every other query in the
 * process rather than just slowing down one tenant.
 *
 * There must be exactly ONE of these per server process, shared by managed and personal admission.
 * Two gates would each let their own traffic up to the limit, so the process would run at twice the
 * intended ceiling. The app builds it once with `_CreateRunAdmissionCapacityGate` and passes the
 * same instance to `__CreateManagedRunAdmissionPort` and `__CreatePersonalRunAdmissionPort`
 * (see apps/opencrane/src/index.ts).
 *
 * Implemented by: `_HierarchicalRunAdmissionCapacityGate` (managed-run-admission.ts).
 */
export interface RunAdmissionCapacityGate
{
	/**
	 * Runs `work` once the process, silo, and service limits all have room.
	 *
	 * @param command - The silo and AgentService the work is for. These are the keys the per-silo and
	 * per-service limits are counted against, so passing a placeholder id shares a queue with every
	 * other caller that passes the same placeholder.
	 * @param work - The admission work to run. It is not started at all if capacity is refused.
	 * @returns The wrapped result of `work`, or a `Rejected` outcome carrying the reason capacity was
	 * refused. `Rejected` means nothing ran and nothing was written, so it is always safe to retry —
	 * unlike most admission denials.
	 */
	execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>;
}

/**
 * Assembles a managed run's snapshot. Called only after the shared capacity gate grants a slot.
 *
 * Exists so the managed admission adapter can be built and tested without a database: the real
 * implementation in managed-run-admission.composition.ts closes over Prisma, while a test supplies
 * a plain function.
 *
 * @param command - The managed run-now command. Note it has no `runId`: the implementation
 * allocates one, because a managed trigger has no client-supplied run identity.
 * @returns The assembler's result verbatim; see {@link AssembleRunInputSnapshotResult}.
 */
export interface ManagedSnapshotAssembler
{
	(command: ManagedRunNowCommand): Promise<AssembleRunInputSnapshotResult>;
}
