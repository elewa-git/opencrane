import { AgentRevisionState, AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, Prisma } from "@prisma/client";

import { __DigestAgentRevisionContent } from "@opencrane/models/agents";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentBudget, type AgentRevisionContent, type RevisionBoundaryAttachment } from "@opencrane/models/agents";

import { type AgentRevisionWriterRepository, type CreateAgentRevisionWithinTransactionCommand } from "./prisma-agent-revision-writer.types";

/** Include every nested assignment required to map a persisted revision back to the domain model. */
export const _AGENT_REVISION_INCLUDE = {
	skillAssignments: true,
	mcpToolAssignments: true,
	boundaryAttachments: true,
} as const;

/** Persisted revision row with every executable assignment required to reconstruct its content. */
type AgentRevisionWithAssignments = Prisma.AgentRevisionGetPayload<{
	readonly include: typeof _AGENT_REVISION_INCLUDE;
}>;

/** Reconstruct complete canonical content from one immutable persisted revision. */
export function _AgentRevisionContentFromRow(row: AgentRevisionWithAssignments): AgentRevisionContent
{
	const budget = row.budget as unknown as AgentBudget;
	return {
		promptPolicyVersion: row.promptPolicyVersion,
		personaRevisionId: row.personaRevisionId,
		modelDefinitionId: row.modelDefinitionId,
		budget: {
			maxTurns: budget.maxTurns,
			maxTokens: budget.maxTokens,
			maxDurationMs: budget.maxDurationMs,
		},
		skills: row.skillAssignments.map(function _MapSkill(skill)
		{
			return { skillId: skill.skillId, revisionId: skill.skillRevisionId };
		}),
		mcpToolRevisionIds: row.mcpToolAssignments.map(function _MapMcpTool(assignment): string { return assignment.toolRevisionId; }).sort(),
		boundaryAttachments: row.boundaryAttachments.map(function _MapBoundary(attachment)
		{
			return _FromPrismaBoundary(attachment);
		}),
	};
}

/**
 * Builds the one Prisma create input used for every new agent revision.
 *
 * The stored digest and the nested skill, MCP tool, and boundary rows all come from the same content
 * value, so the digest always describes exactly what was written. Every writer goes through here —
 * the lifecycle repository and the model-selection strategy both call it — so no second place can
 * drift on how a revision is stored, while each keeps its own transaction.
 */
function _RevisionCreateData(command: CreateAgentRevisionWithinTransactionCommand): Prisma.AgentRevisionCreateInput
{
	return {
		id: command.agentRevisionId,
		agentService: { connect: { id_siloId: { id: command.agentServiceId, siloId: command.siloId } } },
		revision: command.revision,
		parentRevision: command.parentRevisionId === null
			? undefined
			: { connect: { id_siloId: { id: command.parentRevisionId, siloId: command.siloId } } },
		sourceRevision: command.sourceRevisionId === null
			? undefined
			: { connect: { id_siloId: { id: command.sourceRevisionId, siloId: command.siloId } } },
		changeMessage: command.changeMessage,
		state: AgentRevisionState.Draft,
		digest: __DigestAgentRevisionContent(
			command.agentServiceId,
			command.revision,
			command.content,
		),
		promptPolicyVersion: command.content.promptPolicyVersion,
		personaRevisionId: command.content.personaRevisionId,
		modelDefinition: { connect: { id_siloId: { id: command.content.modelDefinitionId, siloId: command.siloId } } },
		budget: {
			maxTurns: command.content.budget.maxTurns,
			maxTokens: command.content.budget.maxTokens,
			maxDurationMs: command.content.budget.maxDurationMs,
		},
		authoredBy: command.authoredBy,
		createdAt: command.createdAt,
		skillAssignments: {
			create: command.content.skills.map(function _MapSkill(skill)
			{
				return { skillId: skill.skillId, skillRevisionId: skill.revisionId };
			}),
		},
		mcpToolAssignments: {
			create: command.content.mcpToolRevisionIds.map(function _MapMcpTool(toolRevisionId)
			{
				return { toolRevisionId, agentServiceId: command.agentServiceId, siloId: command.siloId };
			}),
		},
		boundaryAttachments: {
			create: command.content.boundaryAttachments.map(function _MapBoundary(attachment)
			{
				if (attachment.boundaryKind === RevisionBoundaryKinds.Group)
					return { siloId: command.siloId, boundaryKind: AuthorizationBoundaryKind.Group, boundaryGroupId: attachment.boundaryId, boundaryCoverage: attachment.boundaryCoverage === RevisionBoundaryCoverages.Descendants ? AuthorizationBoundaryCoverage.Descendants : AuthorizationBoundaryCoverage.Exact };
				return { siloId: command.siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: attachment.boundaryId, boundaryCoverage: AuthorizationBoundaryCoverage.Exact };
			}),
		},
	};
}

/**
 * Writes new agent revisions through the one shared Prisma mapping.
 *
 * It takes a transaction rather than a client, so the calling repository keeps ownership of the
 * commit and can roll this write back with its own.
 *
 * Called by: `prisma-agent-revision-lifecycle.ts` (create, revise, restore),
 * `prisma-agent-revision-model-selection.ts` (model swap),
 * `prisma-agent-revision-persona-selection.ts` (persona swap), and
 * `prisma-initial-personal-agent-publication.ts` (onboarding publication).
 */
export class PrismaAgentRevisionWriterRepository implements AgentRevisionWriterRepository
{
	/** Transaction-scoped ORM client supplied by the owning repository or unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the transaction-scoped revision writer. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Creates one draft revision through the canonical agent-service persistence mapping. */
	async createDraft(command: CreateAgentRevisionWithinTransactionCommand)
	{
		return this.transaction.agentRevision.create({
			data: _RevisionCreateData(command),
			include: _AGENT_REVISION_INCLUDE,
		});
	}
}

/** Maps one persisted boundary attachment back to the canonical agent-domain spelling. */
function _FromPrismaBoundary(value: AgentRevisionWithAssignments["boundaryAttachments"][number]): RevisionBoundaryAttachment
{
	if (value.boundaryKind === AuthorizationBoundaryKind.Group && value.boundaryGroupId !== null && value.boundaryPrincipalId === null)
	{
		const boundaryCoverage = value.boundaryCoverage === AuthorizationBoundaryCoverage.Descendants ? RevisionBoundaryCoverages.Descendants : RevisionBoundaryCoverages.Exact;
		return { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: value.boundaryGroupId, boundaryCoverage };
	}
	if (value.boundaryKind === AuthorizationBoundaryKind.Personal && value.boundaryPrincipalId !== null && value.boundaryGroupId === null && value.boundaryCoverage === AuthorizationBoundaryCoverage.Exact)
		return { boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: value.boundaryPrincipalId, boundaryCoverage: RevisionBoundaryCoverages.Exact };
	throw new Error("invalid persisted agent revision boundary attachment");
}
