import { AgentRevisionState, AgentServiceKind, AgentServiceState, PrincipalProvenance, type Prisma } from "@prisma/client";

import { PrismaHumanMembershipEvidenceRepository, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import type { ExecutionSubjectHumanMembershipEvidence } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { ManagedAgentRevisionEvidence, ManagedExecutionEvidenceRepository } from "../managed-agent.types";

/** Loads the managed service binding and the human requester's separate membership in one transaction. */
export class PrismaManagedExecutionEvidenceRepository implements ManagedExecutionEvidenceRepository
{
	/** Binds all mutable authority reads to the transaction that admits the child or its run. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly membership: HumanMembershipEvidenceConfig) {}

	/** Requires an active published revision and refuses unsupported persona, skill and boundary assignments. */
	public async loadCurrent(siloId: string, agentServiceId: string): Promise<ManagedAgentRevisionEvidence | null>
	{
		const service = await this.transaction.agentService.findFirst({
			where: { id: agentServiceId, siloId, kind: AgentServiceKind.Managed, state: AgentServiceState.Active, principal: { is: { siloId, provenance: PrincipalProvenance.Internal } } },
			select: { id: true, principalId: true, name: true, workloadProfile: true, activeRevisionId: true, activeRevision: { select: { id: true, siloId: true, agentServiceId: true, state: true, digest: true, personaRevisionId: true, modelDefinitionId: true, budget: true, skillAssignments: { select: { skillId: true } }, mcpToolAssignments: { select: { toolRevisionId: true } }, boundaryAttachments: { select: { id: true } } } } },
		});
		const revision = service?.activeRevision;
		if (service === null || service.principalId === null || revision === null || revision === undefined
			|| service.activeRevisionId !== revision.id || revision.siloId !== siloId || revision.agentServiceId !== agentServiceId
			|| revision.state !== AgentRevisionState.Published || revision.personaRevisionId !== null
			|| revision.skillAssignments.length !== 0 || revision.boundaryAttachments.length !== 0)
			return null;
		return { agentServiceId: service.id, agentRevisionId: revision.id, agentRevisionDigest: revision.digest, principalId: service.principalId, name: service.name, workloadProfile: service.workloadProfile, modelDefinitionId: revision.modelDefinitionId, mcpToolRevisionIds: revision.mcpToolAssignments.map(assignment => assignment.toolRevisionId).sort(), budget: revision.budget as JsonValue };
	}

	/** Delegates human membership to the deployment-selected IAM authority. */
	async verifyRequesterMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>
	{
		return new PrismaHumanMembershipEvidenceRepository(this.transaction, this.membership).load(siloId, principalId, nowEpochMs);
	}
}
