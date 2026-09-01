import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { __AssembleRunInputSnapshot, __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRunAdmissionUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import type { RunAdmissionConcurrencyPolicy } from "@opencrane/backend/agents/execution/runs";
import type { ManagedRunAdmissionPort } from "@opencrane/backend/server/agents/agent-services";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreateManagedRunAdmissionPortWithGate } from "./managed-run-admission";
import type { ExecutionSubjectAdmissionAuthority } from "./execution-subject-admission.types";
import type { ManagedSnapshotAssembler, RunAdmissionCapacityGate } from "./managed-run-admission.types";

/** Conservative server-process limits aligned to the five-connection Prisma budget. */
const _DEFAULT_POLICY: RunAdmissionConcurrencyPolicy = { maxConcurrentAdmissions: 2, maxQueuedAdmissions: 10 };

/**
 * Read the server-owned admission capacity policy at startup.
 *
 * The limits apply before snapshot assembly or a Prisma transaction starts. They therefore keep one
 * busy AgentService from using every connection in the silo's small database pool.
 *
 * Reads `AGENT_RUN_ADMISSION_MAX_CONCURRENT` (1-2) and `AGENT_RUN_ADMISSION_MAX_QUEUED` (0-100),
 * falling back to 2 and 10. The concurrent ceiling is deliberately tiny because the Prisma
 * connection budget is five.
 *
 * Called by: apps/opencrane/src/index.ts, at startup, before the gate is built.
 *
 * @param environment - Environment map, injectable only for focused configuration tests.
 * @returns The checked limits on how many admissions may run and how many may wait, per service.
 * @throws When either variable is set but is not an integer inside its range. It fails at startup
 * on purpose: silently falling back to a default would hide a deployment mistake until the process
 * was already under load.
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
 * Managed runs are never conversational, so this port allocates the run id itself and passes a null
 * conversation. A caller that wants a conversational run needs
 * {@link __CreatePersonalRunAdmissionPort} instead.
 *
 * Called by: apps/opencrane/src/index.ts.
 *
 * @param prisma - The product database client.
 * @param workflow - Guarded workflow engine that saves the AgentRun task in the admission transaction.
 * @param capacityGate - The shared capacity gate, also used by personal admissions. Pass the same
 * instance, not a second gate.
 * @param executionSubjectAuthority - Resolves the canonical subject while the final
 * admission transaction is open. It is supplied by app composition; no managed evidence adapter
 * may fabricate a subject from requester facts.
 * @returns A fail-closed, capacity-bounded managed run admission port.
 */
export function __CreateManagedRunAdmissionPort(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, capacityGate: RunAdmissionCapacityGate, executionSubjectAuthority: ExecutionSubjectAdmissionAuthority): ManagedRunAdmissionPort
{
	const admission = new PrismaRunAdmissionUnitOfWork(prisma, workflow);
	const authorities = __CreatePrismaSessionAssemblyAuthorities(admission, executionSubjectAuthority);
	const assemble: ManagedSnapshotAssembler = async function _assemble(command)
	{
		const runId = randomUUID();
		return __AssembleRunInputSnapshot({
			runId,
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			conversationId: null,
			trigger: command.trigger,
			requestIdempotencyKey: command.requestIdempotencyKey,
			requester: { subjectId: command.requestedBy, issuer: "server-composed", authenticatedAt: new Date().toISOString() },
		}, authorities);
	};
	return _CreateManagedRunAdmissionPortWithGate(assemble, capacityGate);
}

/** Reads one integer within a range, throwing rather than quietly accepting bad deployment config. */
function _readBoundedPositiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number
{
	const raw = environment[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
	return value;
}
