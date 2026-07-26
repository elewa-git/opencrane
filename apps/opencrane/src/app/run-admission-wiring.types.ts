import type { RunAdmissionCommand, RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import type { AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import type { ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

/** Hierarchical capacity boundary applied before run admission can begin persistence work. */
export interface RunAdmissionCapacityGate
{
	/** Run work only after the global, silo, and service budgets all grant capacity. */
	execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>;
}

/** App-composed managed snapshot assembler used behind the shared capacity gate. */
export interface ManagedSnapshotAssembler
{
	/** Assembles and persists one complete managed root run or returns one stable refusal. */
	(command: ManagedRunNowCommand): Promise<AssembleRunInputSnapshotResult>;
}
