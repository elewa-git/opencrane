import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { PrismaRunAdmissionRepository, RunAdmissionConcurrencyGate } from "@opencrane/backend/agents/execution/runs";
import type { RunAdmissionCommand, RunAdmissionConcurrencyPolicy, RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import type { ManagedRunAdmissionPort, ManagedRunAdmissionResult, ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import type { RunAdmissionCapacityGate } from "./run-admission-wiring.types.js";

/** Conservative server-process limits aligned to the five-connection Prisma budget. */
const _DEFAULT_POLICY: RunAdmissionConcurrencyPolicy = { maxConcurrentAdmissions: 2, maxQueuedAdmissions: 10 };

/**
 * Read the server-owned admission capacity policy at startup.
 *
 * The limits apply before snapshot assembly or a Prisma transaction starts. They therefore bound
 * one hot AgentService without consuming every connection in the silo's small database pool.
 *
 * @param environment - Environment map, injectable only for focused configuration tests.
 * @returns A validated per-service active and waiting admission policy.
 */
export function _ReadRunAdmissionConcurrencyPolicy(environment: NodeJS.ProcessEnv = process.env): RunAdmissionConcurrencyPolicy
{
	return {
		maxConcurrentAdmissions: _ReadBoundedPositiveInteger(environment, "AGENT_RUN_ADMISSION_MAX_CONCURRENT", _DEFAULT_POLICY.maxConcurrentAdmissions, 1, 2),
		maxQueuedAdmissions: _ReadBoundedPositiveInteger(environment, "AGENT_RUN_ADMISSION_MAX_QUEUED", _DEFAULT_POLICY.maxQueuedAdmissions, 0, 100),
	};
}

/**
 * Compose the one shared managed run-admission boundary for this server process.
 *
 * Run-now and the scheduler receive this same port. A single gate is essential: separate gates
 * would let those two entrypoints each exceed the capacity budget for one silo and AgentService.
 *
 * @param prisma - Canonical product-authority client.
 * @param policy - Validated server capacity policy.
 * @returns A fail-closed, capacity-bounded managed run admission port.
 */
export function _CreateManagedRunAdmissionPort(prisma: PrismaClient, policy: RunAdmissionConcurrencyPolicy): ManagedRunAdmissionPort
{
	const admission = new PrismaRunAdmissionRepository(prisma);
	const gate = __CreateRunAdmissionCapacityGate(policy);
	return _CreateManagedRunAdmissionPortWithGate(admission, gate);
}

/** Build the shared global, silo, and service capacity gate for this server process. */
export function __CreateRunAdmissionCapacityGate(policy: RunAdmissionConcurrencyPolicy): RunAdmissionCapacityGate
{
	return new _HierarchicalRunAdmissionCapacityGate(policy);
}

/**
 * Build a managed admission adapter over one supplied gate.
 *
 * Kept separate from Prisma composition so the overload boundary can be proved without a database.
 *
 * @param admission - Canonical run/snapshot/outbox persistence authority.
 * @param gate - Shared process-local capacity boundary.
 * @returns The managed-agent run admission port.
 */
export function _CreateManagedRunAdmissionPortWithGate(admission: Pick<PrismaRunAdmissionRepository, "admit">, gate: RunAdmissionCapacityGate): ManagedRunAdmissionPort
{
	return {
		async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
		{
			const bounded = await gate.execute(
				{ siloId: command.siloId, agentServiceId: command.agentServiceId },
				async function _admitAfterCapacityGrant()
				{
					const runId = randomUUID();
					const result = await admission.admit(
						{ runId, siloId: command.siloId, agentServiceId: command.agentServiceId, threadId: null, executionSubjectId: `agent-service:${command.agentServiceId}`, requestIdempotencyKey: command.requestIdempotencyKey },
						// The managed executor (fleet-membership + capability-set snapshot assembly) is a
						// live-Obot gate. Until then the shared persistence authority fails closed.
						async function _assembleManagedSnapshot() { return { outcome: "denied", reason: "run_admission_unavailable" } as const; },
					);
					if (result.outcome === "denied") return { outcome: "denied", reason: result.reason } as const;
					return { outcome: result.outcome, runId } as const;
				},
			);
			return bounded.outcome === "rejected" ? { outcome: "denied", reason: bounded.reason } : bounded.value;
		},
	};
}

/** Apply a process ceiling before silo and exact-service fairness gates. */
class _HierarchicalRunAdmissionCapacityGate implements RunAdmissionCapacityGate
{
	private readonly globalGate: RunAdmissionConcurrencyGate;
	private readonly siloGate: RunAdmissionConcurrencyGate;
	private readonly serviceGate: RunAdmissionConcurrencyGate;

	constructor(policy: RunAdmissionConcurrencyPolicy)
	{
		this.globalGate = new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: policy.maxConcurrentAdmissions * 2, maxQueuedAdmissions: policy.maxQueuedAdmissions * 2 });
		this.siloGate = new RunAdmissionConcurrencyGate(policy);
		this.serviceGate = new RunAdmissionConcurrencyGate(policy);
	}

	/** Grant work only when process, silo, and service budgets all have capacity. */
	async execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>
	{
		const global = await this.globalGate.execute(_GLOBAL_ADMISSION_COORDINATE, async () => await this.siloGate.execute({ siloId: command.siloId, agentServiceId: "__silo_capacity__" }, async () => await this.serviceGate.execute(command, work)));
		if (global.outcome === "rejected") return global;
		if (global.value.outcome === "rejected") return global.value;
		return global.value.value;
	}
}

/** Synthetic, non-user-visible coordinate that serializes every managed admission in one process. */
const _GLOBAL_ADMISSION_COORDINATE = { siloId: "__opencrane_process__", agentServiceId: "__managed_run_admission__" };

/** Read one bounded non-negative integer without silently coercing malformed deployment config. */
function _ReadBoundedPositiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}
