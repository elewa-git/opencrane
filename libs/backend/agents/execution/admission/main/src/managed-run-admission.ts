import { RunAdmissionConcurrencyGate, type RunAdmissionCommand, type RunAdmissionConcurrencyPolicy, type RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import { ManagedRunAdmissionOutcomes, type ManagedRunAdmissionPort, type ManagedRunAdmissionResult, type ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import type { ManagedSnapshotAssembler, RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** Synthetic, non-user-visible coordinate that serializes every personal and managed admission in one process. */
const _GLOBAL_ADMISSION_COORDINATE = { siloId: "__opencrane_process__", agentServiceId: "__opencrane_run_admission__" };

/** Build the shared global, silo, and service capacity gate for one server process. */
export function _CreateRunAdmissionCapacityGate(policy: RunAdmissionConcurrencyPolicy): RunAdmissionCapacityGate
{
	return new _HierarchicalRunAdmissionCapacityGate(policy);
}

/**
 * Build a managed admission adapter over one supplied gate.
 *
 * Kept separate from Prisma composition so the overload boundary can be proved without a database.
 *
 * @param assemble - Complete immutable managed run assembler and persistence boundary.
 * @param gate - Shared process-local capacity boundary.
 * @returns The managed-agent run admission port.
 */
export function _CreateManagedRunAdmissionPortWithGate(assemble: ManagedSnapshotAssembler, gate: RunAdmissionCapacityGate): ManagedRunAdmissionPort
{
	return {
		async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
		{
			const bounded = await gate.execute(
				{ siloId: command.siloId, agentServiceId: command.agentServiceId },
				async function _admitAfterCapacityGrant()
				{
					const result = await assemble(command);
					if ("reason" in result) return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: result.reason } as const;
					return { outcome: result.admissionOutcome === "accepted" ? ManagedRunAdmissionOutcomes.Accepted : ManagedRunAdmissionOutcomes.Idempotent, runId: result.snapshot.runId } as const;
				},
			);
			return "reason" in bounded ? { outcome: ManagedRunAdmissionOutcomes.Denied, reason: bounded.reason } : bounded.value;
		},
	};
}

/** Apply a process ceiling before silo and exact-service fairness gates. */
class _HierarchicalRunAdmissionCapacityGate implements RunAdmissionCapacityGate
{
	/** Process-wide admission gate sized below the shared database connection budget. */
	private readonly globalGate: RunAdmissionConcurrencyGate;

	/** Per-silo gate that prevents one tenant from exhausting process capacity. */
	private readonly siloGate: RunAdmissionConcurrencyGate;

	/** Per-service gate that prevents one personal or managed AgentService from monopolizing its silo. */
	private readonly serviceGate: RunAdmissionConcurrencyGate;

	/** Create the three nested gates from one validated per-service policy. */
	constructor(policy: RunAdmissionConcurrencyPolicy)
	{
		this.globalGate = new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: policy.maxConcurrentAdmissions * 2, maxQueuedAdmissions: policy.maxQueuedAdmissions * 2 });
		this.siloGate = new RunAdmissionConcurrencyGate(policy);
		this.serviceGate = new RunAdmissionConcurrencyGate(policy);
	}

	/** Grant work only when process, silo, and service budgets all have capacity. */
	async execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>
	{
		const siloGate = this.siloGate;
		const serviceGate = this.serviceGate;
		const global = await this.globalGate.execute(_GLOBAL_ADMISSION_COORDINATE, async function _afterGlobalGrant()
		{
			return siloGate.execute(
				{ siloId: command.siloId, agentServiceId: "__silo_capacity__" },
				async function _afterSiloGrant()
				{
					return serviceGate.execute(command, work);
				},
			);
		});
		if ("reason" in global) return global;
		if ("reason" in global.value) return global.value;
		return global.value.value;
	}
}
