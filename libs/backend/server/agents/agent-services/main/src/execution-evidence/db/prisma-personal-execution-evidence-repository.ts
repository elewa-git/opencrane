import { AgentRevisionState, AgentServiceKind, AgentServiceState, AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, type Prisma } from "@prisma/client";

import { PrismaHumanMembershipEvidenceRepository, type HumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type ExecutionSubjectHumanMembershipEvidence, type RevisionBoundaryAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { PersonalExecutionEvidenceRepository, PersonalExecutionRevisionEvidence } from "../personal-execution-evidence.types";

/** Owns personal execution-evidence reads on the exact transaction that will persist the run. */
export class PrismaPersonalExecutionEvidenceRepository implements PersonalExecutionEvidenceRepository
{
	/** Membership repository bound to the same run-admission transaction. */
	private readonly membership: PrismaHumanMembershipEvidenceRepository;

	/** Binds all revision and membership reads to one admission transaction. */
	constructor(private readonly prisma: Prisma.TransactionClient, config: HumanMembershipEvidenceConfig)
	{
		this.membership = new PrismaHumanMembershipEvidenceRepository(this.prisma, config);
	}

	/** Loads only the exact published revision of the exact active Personal service. */
	async loadActiveRevision(siloId: string, agentServiceId: string, agentRevisionId: string): Promise<PersonalExecutionRevisionEvidence | null>
	{
		const revision = await this.prisma.agentRevision.findFirst({
			where: { id: agentRevisionId, siloId, agentServiceId, state: AgentRevisionState.Published, agentService: { is: { id: agentServiceId, siloId, kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: agentRevisionId } } },
			select: { id: true, digest: true, modelDefinitionId: true, budget: true, boundaryAttachments: { select: { boundaryKind: true, boundaryGroupId: true, boundaryPrincipalId: true, boundaryCoverage: true } }, skillAssignments: { select: { skillId: true, skillRevisionId: true } }, mcpToolAssignments: { select: { toolRevisionId: true } } },
		});
		if (revision === null)
			return null;
		return { id: revision.id, digest: revision.digest, modelDefinitionId: revision.modelDefinitionId, budget: revision.budget as JsonValue, boundaryAttachments: revision.boundaryAttachments.map(_Attachment), skillAssignments: revision.skillAssignments, mcpToolRevisionIds: revision.mcpToolAssignments.map(function _ToolId(assignment): string { return assignment.toolRevisionId; }) };
	}

	/** Delegates human membership to the deployment-selected IAM authority. */
	async verifyCurrentMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<ExecutionSubjectHumanMembershipEvidence | null>
	{
		return this.membership.load(siloId, principalId, nowEpochMs);
	}
}

/** Maps one structurally valid Prisma boundary row into the stable revision contract. */
function _Attachment(value: { boundaryKind: AuthorizationBoundaryKind; boundaryGroupId: string | null; boundaryPrincipalId: string | null; boundaryCoverage: AuthorizationBoundaryCoverage }): RevisionBoundaryAttachment
{
	if (value.boundaryKind === AuthorizationBoundaryKind.Group && value.boundaryGroupId !== null && value.boundaryPrincipalId === null)
	{
		const boundaryCoverage = value.boundaryCoverage === AuthorizationBoundaryCoverage.Descendants ? RevisionBoundaryCoverages.Descendants : RevisionBoundaryCoverages.Exact;
		return { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: value.boundaryGroupId, boundaryCoverage };
	}
	if (value.boundaryKind === AuthorizationBoundaryKind.Personal && value.boundaryPrincipalId !== null && value.boundaryGroupId === null && value.boundaryCoverage === AuthorizationBoundaryCoverage.Exact)
		return { boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: value.boundaryPrincipalId, boundaryCoverage: RevisionBoundaryCoverages.Exact };
	throw new Error("invalid persisted personal revision boundary attachment");
}
