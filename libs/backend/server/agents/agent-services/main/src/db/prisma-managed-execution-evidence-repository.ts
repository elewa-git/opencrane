import { AgentRevisionState, AgentServiceKind, AgentServiceState, PrincipalProvenance, type Prisma } from "@prisma/client";

import { __SelectCurrentFleetMembershipAssertion, __VerifyCurrentFleetMembershipEvidence, FleetMembershipAssertionSelectionOutcomes, FleetMembershipEvidenceOutcomes, PrismaFleetMembershipAuthorityRepository, type FleetMembershipEvidenceConfig, type TrustedFleetMembershipEvidence } from "@opencrane/backend/server/iam/membership";
import type { JsonValue } from "@opencrane/util";

import type { ManagedAgentRevisionEvidence, ManagedExecutionEvidenceRepository } from "../managed-agent.types";

/** Loads the managed service binding and the human requester's separate signed membership in one transaction. */
export class PrismaManagedExecutionEvidenceRepository implements ManagedExecutionEvidenceRepository
{
	/** Binds all mutable authority reads to the transaction that admits the child or its run. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly membership: FleetMembershipEvidenceConfig) {}

	/** Rejects inactive or extended revisions before a company assistant can acquire conversation authority. */
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
			|| revision.skillAssignments.length !== 0 || revision.mcpToolAssignments.length !== 0 || revision.boundaryAttachments.length !== 0)
			return null;
		return { agentServiceId: service.id, agentRevisionId: revision.id, agentRevisionDigest: revision.digest, principalId: service.principalId, name: service.name, workloadProfile: service.workloadProfile, modelDefinitionId: revision.modelDefinitionId, budget: revision.budget as JsonValue };
	}

	/** Verifies a current fleet assertion for the requesting human without assigning it to the managed Principal. */
	public async verifyRequesterMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<TrustedFleetMembershipEvidence | null>
	{
		const repository = new PrismaFleetMembershipAuthorityRepository(this.transaction);
		const selected = await __SelectCurrentFleetMembershipAssertion(repository, { trustedIssuerId: this.membership.trustedIssuerId, siloId, subjectId: principalId });
		if (selected.outcome === FleetMembershipAssertionSelectionOutcomes.Denied)
			return null;
		const verified = await __VerifyCurrentFleetMembershipEvidence(repository, this.membership.verifier, { trustedIssuerId: this.membership.trustedIssuerId, siloId, subjectId: principalId, assertionId: selected.assertionId, nowEpochMs, maximumStalenessMs: this.membership.maximumStalenessMs });
		return verified.outcome === FleetMembershipEvidenceOutcomes.Trusted && verified.evidence.subjectId === principalId ? verified.evidence : null;
	}
}
