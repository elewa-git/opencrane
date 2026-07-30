import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaManagedSessionAssemblyAuthorities, ManagedExecutionIdentityEnvelopeSource, PrismaSkillRevisionEligibilitySource } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionRepository, RunAdmissionConcurrencyGate } from "@opencrane/backend/agents/execution/runs";
import type { RunAdmissionCommand, RunAdmissionConcurrencyPolicy, RunAdmissionConcurrencyResult } from "@opencrane/backend/agents/execution/runs";
import type { ManagedExecutionEvidenceAuthority, ManagedRunAdmissionPort, ManagedRunAdmissionResult, ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import type { ManagedSnapshotAssembler, RunAdmissionCapacityGate } from "./managed-run-admission.types.js";

/** Conservative server-process limits aligned to the five-connection Prisma budget. */
const _DEFAULT_POLICY: RunAdmissionConcurrencyPolicy = { maxConcurrentAdmissions: 2, maxQueuedAdmissions: 10 };

/** Synthetic, non-user-visible coordinate that serializes every managed admission in one process. */
const _GLOBAL_ADMISSION_COORDINATE = { siloId: "__opencrane_process__", agentServiceId: "__managed_run_admission__" };

/**
 * Read the server-owned admission capacity policy at startup.
 *
 * The limits apply before snapshot assembly or a Prisma transaction starts. They therefore bound
 * one hot AgentService without consuming every connection in the silo's small database pool.
 *
 * @param environment - Environment map, injectable only for focused configuration tests.
 * @returns A validated per-service active and waiting admission policy.
 */
export function __ReadRunAdmissionConcurrencyPolicy(environment: NodeJS.ProcessEnv = process.env): RunAdmissionConcurrencyPolicy
{
	return {
		maxConcurrentAdmissions: _readBoundedPositiveInteger(environment, "AGENT_RUN_ADMISSION_MAX_CONCURRENT", _DEFAULT_POLICY.maxConcurrentAdmissions, 1, 2),
		maxQueuedAdmissions: _readBoundedPositiveInteger(environment, "AGENT_RUN_ADMISSION_MAX_QUEUED", _DEFAULT_POLICY.maxQueuedAdmissions, 0, 100),
	};
}

/**
 * Compose the one shared managed run-admission boundary for a server process.
 *
 * Run-now and the scheduler receive this same port. A single gate is essential: separate gates
 * would let those two entrypoints each exceed the capacity budget for one silo and AgentService.
 *
 * @param prisma - Canonical product-authority client.
 * @param policy - Validated server capacity policy.
 * @param evidenceAuthority - Service-owned signed identity and scope-capability authority.
 * @returns A fail-closed, capacity-bounded managed run admission port.
 */
export function __CreateManagedRunAdmissionPort(prisma: PrismaClient, policy: RunAdmissionConcurrencyPolicy, evidenceAuthority: ManagedExecutionEvidenceAuthority): ManagedRunAdmissionPort
{
	const admission = new PrismaRunAdmissionRepository(prisma);
	const gate = _CreateRunAdmissionCapacityGate(policy);
	const identityEnvelope = new ManagedExecutionIdentityEnvelopeSource(evidenceAuthority);
	const authorities = __CreatePrismaManagedSessionAssemblyAuthorities(admission, identityEnvelope, new PrismaSkillRevisionEligibilitySource());
	const assemble: ManagedSnapshotAssembler = async function _assemble(command)
	{
		return __AssembleRunInputSnapshot({
			runId: randomUUID(),
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			threadId: null,
			identityKind: "service",
			trigger: command.trigger,
			requestIdempotencyKey: command.requestIdempotencyKey,
		}, authorities);
	};
	return _CreateManagedRunAdmissionPortWithGate(assemble, gate);
}

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
					if (result.outcome === "denied") return { outcome: "denied", reason: result.reason } as const;
					return { outcome: result.admissionOutcome, runId: result.snapshot.runId } as const;
				},
			);
			return bounded.outcome === "rejected" ? { outcome: "denied", reason: bounded.reason } : bounded.value;
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

	/** Per-service gate that prevents one managed agent from monopolizing its silo. */
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
		if (global.outcome === "rejected") return global;
		if (global.value.outcome === "rejected") return global.value;
		return global.value.value;
	}
}

/** Read one bounded non-negative integer without silently coercing malformed deployment config. */
function _readBoundedPositiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}
