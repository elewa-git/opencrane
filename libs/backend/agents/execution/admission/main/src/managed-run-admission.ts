import { RunInputSnapshotAdmissionOutcomes, SessionAssemblyOutcomes, type SessionAssemblyRefusalReason } from "@opencrane/backend/agents/execution/inputs";
import { RunAdmissionConcurrencyGate, RunAdmissionConcurrencyOutcomes, RunAdmissionDenialReasons, type RunAdmissionCommand, type RunAdmissionConcurrencyPolicy, type RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import { ManagedRunAdmissionOutcomes, type ManagedRunAdmissionPort, type ManagedRunAdmissionResult, type ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import type { ManagedSnapshotAssembler, RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** Fake silo and service ids used only as the key for the process-wide gate, so every personal and managed admission queues behind it. */
const _GLOBAL_ADMISSION_COORDINATE = { siloId: "__opencrane_process__", agentServiceId: "__opencrane_run_admission__" };

/**
 * Build the one capacity gate a server process shares between managed and personal admission.
 *
 * Call this exactly once per process and pass the result to both
 * `__CreateManagedRunAdmissionPort` and `__CreatePersonalRunAdmissionPort`. Two gates would each
 * allow their own traffic up to the limit, so the process would run at twice its intended ceiling
 * and could exhaust the database connection pool.
 *
 * Called by: apps/opencrane/src/index.ts.
 *
 * @param policy - Per-service limits on how many admissions may run and how many may wait. The
 * process-wide limits are derived from these (doubled); the silo and service limits use them as-is.
 * @returns The gate. Share the instance; do not build one per route or per request.
 * @see RunAdmissionCapacityGate
 */
export function _CreateRunAdmissionCapacityGate(policy: RunAdmissionConcurrencyPolicy): RunAdmissionCapacityGate
{
	return new _HierarchicalRunAdmissionCapacityGate(policy);
}

/**
 * Build a managed admission adapter over one supplied gate.
 *
 * Kept separate from the Prisma composition so tests can check the capacity limits without a
 * database. Use {@link __CreateManagedRunAdmissionPort} in production; this overload exists for
 * callers that already own both pieces.
 *
 * It also translates one refusal: `active_run` can only happen to a conversational run, and managed
 * runs are never conversational, so if it ever appears it is reported as `persistence_unavailable`
 * rather than leaking a conversation concept into the managed contract.
 *
 * Called by: `__CreateManagedRunAdmissionPort` (managed-run-admission.composition.ts) and
 * `__tests__/managed-run-admission.test.ts`.
 *
 * @param assemble - Assembles and saves the managed run's immutable snapshot.
 * @param gate - The capacity gate shared across this server process. Must be the same instance
 * personal admission was given.
 * @returns The managed-agent run admission port. Its `Accepted` and `Idempotent` outcomes mean the
 * same things as {@link RunInputSnapshotAdmissionOutcomes}, and must not be collapsed.
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
					if (result.outcome === SessionAssemblyOutcomes.Denied)
					{
						if (_isActiveRunDenial(result.reason)) return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: RunAdmissionDenialReasons.PersistenceUnavailable } as const;
						return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: result.reason } as const;
					}
					return { outcome: result.admissionOutcome === RunInputSnapshotAdmissionOutcomes.Accepted ? ManagedRunAdmissionOutcomes.Accepted : ManagedRunAdmissionOutcomes.Idempotent, runId: result.snapshot.runId } as const;
				},
			);
			return bounded.outcome === RunAdmissionConcurrencyOutcomes.Rejected ? { outcome: ManagedRunAdmissionOutcomes.Denied, reason: bounded.reason } : bounded.value;
		},
	};
}

/** Returns whether the refusal is `active_run`, which only conversational runs can hit — managed runs are never conversational. */
function _isActiveRunDenial(reason: SessionAssemblyRefusalReason): reason is RunAdmissionDenialReasons.ActiveRun
{
	return reason === RunAdmissionDenialReasons.ActiveRun;
}

/** Checks the process-wide limit first, then the silo limit, then the service limit. */
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
		if (global.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return global;
		if (global.value.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return global.value;
		return global.value.value;
	}
}
