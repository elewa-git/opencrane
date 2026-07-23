import type { RunAdmissionCommand, RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";

/** Hierarchical capacity boundary applied before run admission can begin persistence work. */
export interface RunAdmissionCapacityGate
{
	/** Run work only after the global, silo, and service budgets all grant capacity. */
	execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>;
}
