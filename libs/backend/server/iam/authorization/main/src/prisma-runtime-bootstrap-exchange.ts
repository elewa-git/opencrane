import { WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, type AgentRuntimeProjectedTokenAudience, type ManagedAgentRuntimeProjectedTokenAudience } from "@opencrane/contracts";

import { PrismaRuntimeAuthorityRepository } from "./prisma-runtime-authority";
import type { RuntimeBootstrapClaim, RuntimeBootstrapConsumptionResult } from "./runtime-proof.types";
import type { RuntimeBootstrapExchangeRecord, RuntimeBootstrapExchangeRepository } from "./runtime-bootstrap.types";

/** Maps a Prisma workload-kind enum member to the plain bootstrap-kind string the contract exposes, so no Prisma type crosses the boundary. */
function _toWorkloadKind(kind: WorkloadKind): "job" | "deployment"
{
	return kind === WorkloadKind.Job ? "job" : "deployment";
}

/** Returns the value only when it is one of the two accepted runtime token audiences, otherwise null. */
function _toRuntimeAudience(value: string): AgentRuntimeProjectedTokenAudience | ManagedAgentRuntimeProjectedTokenAudience | null
{
	if (value === AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE || value === MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE) return value;
	return null;
}

/**
 * Prisma-backed runtime bootstrap-exchange authority.
 *
 * It loads the durable WorkloadBootstrap together with its independent WorkloadAssignment so the
 * router can cross-check both against the reviewed Pod identity, and delegates the atomic
 * single-consumption and proof-key binding to the shared runtime authority repository.
 */
export class PrismaRuntimeBootstrapExchange implements RuntimeBootstrapExchangeRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Shared atomic consume-and-bind authority reused unchanged for single-consumption. */
	private readonly authority: PrismaRuntimeAuthorityRepository;

	/** Creates the bootstrap-exchange adapter over the product-authority Postgres database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
		this.authority = new PrismaRuntimeAuthorityRepository(prisma);
	}

	/**
	 * Loads one bootstrap plus the separately written assignment for the same run attempt.
	 * @param bootstrapReference - The opaque one-use reference projected into the runtime pod.
	 * @returns Both rows' fields side by side, deliberately not merged. Null when the bootstrap is
	 *   missing, when no pod has registered yet, or when either row carries an audience we do not
	 *   recognise — the router turns all three into one 409 so nothing about stored state leaks.
	 */
	async loadBootstrapExchange(bootstrapReference: string): Promise<RuntimeBootstrapExchangeRecord | null>
	{
		// 1. Load the bootstrap row keyed by the opaque reference.
		const bootstrap = await this.prisma.workloadBootstrap.findUnique({ where: { id: bootstrapReference } });
		if (bootstrap === null) return null;

		// 2. Load its independent assignment; a bootstrap cannot bind before the first Pod registers.
		const assignment = await this.prisma.workloadAssignment.findUnique({ where: { runId_attempt: { runId: bootstrap.runId, attempt: bootstrap.attempt } } });
		if (assignment === null || assignment.podUid === null || assignment.state !== WorkloadAssignmentState.Registered) return null;
		const bootstrapAudience = _toRuntimeAudience(bootstrap.audience);
		const assignmentAudience = _toRuntimeAudience(assignment.audience);
		if (bootstrapAudience === null || assignmentAudience === null) return null;

		// 3. Return both authority sources so the router can compare them field by field.
		return {
			bootstrapId: bootstrap.id,
			bootstrapSiloId: bootstrap.siloId,
			bootstrapSubjectId: bootstrap.subjectId,
			bootstrapAudience,
			bootstrapServiceAccountName: bootstrap.serviceAccountName,
			bootstrapNamespace: bootstrap.namespace,
			bootstrapWorkloadKind: _toWorkloadKind(bootstrap.workloadKind),
			bootstrapWorkloadUid: bootstrap.workloadUid,
			bootstrapRunId: bootstrap.runId,
			bootstrapAgentServiceId: bootstrap.agentServiceId,
			bootstrapAttempt: bootstrap.attempt,
			bootstrapAgentRevisionId: bootstrap.agentRevisionId,
			bootstrapExpiresAtEpochMs: bootstrap.expiresAt.getTime(),
			assignmentSiloId: assignment.siloId,
			assignmentSubjectId: assignment.subjectId,
			assignmentAudience,
			assignmentWorkloadKind: _toWorkloadKind(assignment.workloadKind),
			assignmentWorkloadUid: assignment.workloadUid,
			assignmentPodUid: assignment.podUid,
			assignmentRunId: assignment.runId,
			assignmentAgentServiceId: assignment.agentServiceId,
			assignmentAttempt: assignment.attempt,
			assignmentAgentRevisionId: assignment.agentRevisionId,
		};
	}

	/** Delegates atomic single-consumption and proof-key binding to the shared runtime authority. */
	async consumeAndBindProofKeyAtomically(claim: RuntimeBootstrapClaim): Promise<RuntimeBootstrapConsumptionResult>
	{
		return this.authority.consumeAndBindProofKeyAtomically(claim);
	}
}
