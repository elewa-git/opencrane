import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaManagedSessionAssemblyAuthorities, ManagedExecutionIdentityEnvelopeSource, PrismaSkillRevisionEligibilitySource } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { RunAdmissionConcurrencyPolicy } from "@opencrane/backend/agents/execution/runs";
import type { ManagedExecutionEvidenceAuthority, ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";

import { _CreateManagedRunAdmissionPortWithGate, _CreateRunAdmissionCapacityGate } from "./managed-run-admission.js";
import type { ManagedSnapshotAssembler } from "./managed-run-admission.types.js";

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

/** Read one bounded non-negative integer without silently coercing malformed deployment config. */
function _readBoundedPositiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}
