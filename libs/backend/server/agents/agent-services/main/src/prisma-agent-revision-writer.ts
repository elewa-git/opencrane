import { AgentRevisionState, GrantScope, GrantSubjectType, Prisma } from "@prisma/client";

import { __DigestAgentRevisionContent } from "@opencrane/models/agents";
import type { AgentBudget, AgentRevisionContent, GrantScope as DomainGrantScope, GrantSubjectType as DomainGrantSubjectType } from "@opencrane/models/agents";

import { type AgentRevisionWriterRepository, type CreateAgentRevisionWithinTransactionCommand } from "./prisma-agent-revision-writer.types.js";

/** Include every nested assignment required to map a persisted revision back to the domain model. */
export const _AGENT_REVISION_INCLUDE = {
	skillAssignments: true,
	integrationAssignments: true,
	scopeAttachments: true,
} as const;

/** Persisted revision row with every executable assignment required to reconstruct its content. */
type AgentRevisionWithAssignments = Prisma.AgentRevisionGetPayload<{
	readonly include: typeof _AGENT_REVISION_INCLUDE;
}>;

/** Maps the domain scope spelling to the Prisma enum persisted on revision attachments. */
function _ToPrismaScope(value: DomainGrantScope): GrantScope
{
	switch (value)
	{
		case "org": return GrantScope.Org;
		case "department": return GrantScope.Department;
		case "team": return GrantScope.Team;
		case "project": return GrantScope.Project;
		case "personal": return GrantScope.Personal;
		default: throw new Error(`unknown scope: ${value as string}`);
	}
}

/** Maps the domain subject spelling to the Prisma enum persisted on revision attachments. */
function _ToPrismaSubjectType(value: DomainGrantSubjectType): GrantSubjectType
{
	switch (value)
	{
		case "group": return GrantSubjectType.Group;
		case "user": return GrantSubjectType.User;
		default: throw new Error(`unknown subject type: ${value as string}`);
	}
}

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
		integrationAssignments: row.integrationAssignments.map(function _MapIntegration(assignment)
		{
			return {
				integrationId: assignment.integrationId,
				custodyReferenceId: assignment.custodyReferenceId,
				allowedTools: [...assignment.allowedTools],
			};
		}),
		scopeAttachments: row.scopeAttachments.map(function _MapScope(attachment)
		{
			return {
				scope: _FromPrismaScope(attachment.scope),
				subjectType: _FromPrismaSubjectType(attachment.subjectType),
				subjectId: attachment.subjectId,
			};
		}),
	};
}

/**
 * Builds the sole Prisma create representation of immutable agent-revision content.
 *
 * The digest and nested assignment writes derive from the same domain value. Keeping this mapping
 * in the agent-service authority prevents another package from independently reproducing revision
 * persistence rules while still allowing an existing transaction to remain atomic.
 */
function _RevisionCreateData(command: CreateAgentRevisionWithinTransactionCommand): Prisma.AgentRevisionCreateInput
{
	return {
		agentService: { connect: { id: command.agentServiceId } },
		revision: command.revision,
		parentRevision: command.parentRevisionId === null
			? undefined
			: { connect: { id: command.parentRevisionId } },
		sourceRevision: command.sourceRevisionId === null
			? undefined
			: { connect: { id: command.sourceRevisionId } },
		changeMessage: command.changeMessage,
		state: AgentRevisionState.Draft,
		digest: __DigestAgentRevisionContent(
			command.agentServiceId,
			command.revision,
			command.content,
		),
		promptPolicyVersion: command.content.promptPolicyVersion,
		personaRevisionId: command.content.personaRevisionId,
		modelDefinition: { connect: { id: command.content.modelDefinitionId } },
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
		integrationAssignments: {
			create: command.content.integrationAssignments.map(function _MapIntegration(assignment)
			{
				return {
					integrationId: assignment.integrationId,
					siloId: command.siloId,
					custodyReferenceId: assignment.custodyReferenceId,
					allowedTools: [...assignment.allowedTools],
				};
			}),
		},
		scopeAttachments: {
			create: command.content.scopeAttachments.map(function _MapScope(attachment)
			{
				return {
					scope: _ToPrismaScope(attachment.scope),
					subjectType: _ToPrismaSubjectType(attachment.subjectType),
					subjectId: attachment.subjectId,
				};
			}),
		},
	};
}

/** Prisma repository for the canonical immutable revision persistence mapping. */
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

/** Maps the Prisma scope spelling back to the canonical agent-domain spelling. */
function _FromPrismaScope(value: GrantScope): DomainGrantScope
{
	switch (value)
	{
		case GrantScope.Org: return "org";
		case GrantScope.Department: return "department";
		case GrantScope.Team: return "team";
		case GrantScope.Project: return "project";
		case GrantScope.Personal: return "personal";
		default: throw new Error(`unknown persisted grant scope: ${value}`);
	}
}

/** Maps the Prisma subject spelling back to the canonical agent-domain spelling. */
function _FromPrismaSubjectType(value: GrantSubjectType): DomainGrantSubjectType
{
	switch (value)
	{
		case GrantSubjectType.Group: return "group";
		case GrantSubjectType.User: return "user";
		default: throw new Error(`unknown persisted grant subject type: ${value}`);
	}
}
