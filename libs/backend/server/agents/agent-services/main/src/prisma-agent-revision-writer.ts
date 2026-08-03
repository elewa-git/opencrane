import { AgentRevisionState, AgentServiceKind, AgentServiceState, GrantScope, GrantSubjectType, ModelRoutingScope, Prisma } from "@prisma/client";

import { __DigestAgentRevisionContent } from "@opencrane/models/agents";
import type { AgentBudget, AgentRevisionContent, GrantScope as DomainGrantScope, GrantSubjectType as DomainGrantSubjectType } from "@opencrane/models/agents";

import { AgentRevisionModelSelectionMaterializationCodes, type AgentRevisionModelSelectionRepository, type AgentRevisionWriterRepository, type CreateAgentRevisionWithinTransactionCommand, type MaterializeAgentRevisionModelSelectionCommand, type MaterializeAgentRevisionModelSelectionResult } from "./prisma-agent-revision-writer.types.js";

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
async function _RevisionCreateData(command: CreateAgentRevisionWithinTransactionCommand): Promise<Prisma.AgentRevisionCreateInput>
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
		digest: await __DigestAgentRevisionContent(
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
			data: await _RevisionCreateData(command),
			include: _AGENT_REVISION_INCLUDE,
		});
	}
}

/**
 * Prisma repository for model-selection changes inside an owning unit of work.
 *
 * The caller must provide a Serializable transaction. Agent-services then proves that the expected
 * personal revision remains active, reconstructs its canonical executable content, changes only
 * the model definition, appends and publishes the next revision, and activates it. Returning a
 * stale result performs no writes. The caller retains the transaction solely so its own journal
 * transition can commit or roll back with these mutations.
 *
 * It owns all agent-service ORM reads and writes, while the caller's unit of work owns the
 * surrounding transaction. This keeps the service's revision mapping private without allowing a
 * use case or materializer to depend on Prisma.
 */
export class PrismaAgentRevisionModelSelectionRepository implements AgentRevisionModelSelectionRepository
{
	/** Transaction-scoped ORM client supplied only by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the transaction-scoped repository adapter. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Revalidates, clones, publishes, and activates one selected-model revision.
	 *
	 * Returning a refusal performs no writes. A successful return has prepared every agent-service
	 * mutation in the caller's transaction, which may still roll back if the owning proposal loses
	 * its final compare-and-set fence.
	 */
	async materialize(command: MaterializeAgentRevisionModelSelectionCommand): Promise<MaterializeAgentRevisionModelSelectionResult>
	{
		// 1. Revalidate the personal service against the revision the owner reviewed.
		// Returning before any write makes stale or retired services safe to retry.
		const service = await this.transaction.agentService.findFirst({
		where: {
			id: command.agentServiceId,
			siloId: command.siloId,
			kind: AgentServiceKind.Personal,
			state: AgentServiceState.Active,
		},
		select: { id: true, activeRevisionId: true },
		});
		if (service === null || service.activeRevisionId !== command.expectedSourceRevisionId)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };
		}

	// 2. Load the exact published source and prove its persona is still the accepted one.
	// This prevents a model choice from being copied onto a newer personality by accident.
		const source = await this.transaction.agentRevision.findFirst({
		where: {
			id: command.expectedSourceRevisionId,
			agentServiceId: service.id,
			state: AgentRevisionState.Published,
		},
		include: _AGENT_REVISION_INCLUDE,
		});
		if (source === null || source.personaRevisionId !== command.expectedPersonaRevisionId)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };
		}

	// 3. Prove the active source is also the latest persisted revision in this service lineage.
	// A later draft or rejected revision must produce a conflict instead of a duplicate number.
		const latest = await this.transaction.agentRevision.findFirst({
		where: { agentServiceId: service.id },
		orderBy: { revision: "desc" },
		select: { id: true },
		});
		if (latest?.id !== source.id)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };
		}

	// 4. Resolve the owner-visible alias only after every source fence has passed.
	// Tenant definitions take precedence, and no provider identifier crosses the browser boundary.
		const modelDefinitionId = await this._ResolveModelDefinitionId(
			command.siloId,
			command.modelAlias,
		);
		if (modelDefinitionId === null)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable };
		}

	// 5. Reconstruct one canonical content value and append the next immutable draft.
	// Agent-services alone chooses revision lineage and represents that content in Prisma.
		const sourceContent = _AgentRevisionContentFromRow(source);
		const content: AgentRevisionContent = {
			...sourceContent,
			modelDefinitionId,
		};
		const draft = await new PrismaAgentRevisionWriterRepository(this.transaction).createDraft({
		siloId: command.siloId,
		agentServiceId: command.agentServiceId,
		revision: source.revision + 1,
		parentRevisionId: source.id,
		sourceRevisionId: null,
		content,
		changeMessage: command.changeMessage,
		authoredBy: command.authoredBy,
		createdAt: command.materializedAt,
		});

	// 6. Publish before activation, while remaining inside the caller-owned transaction.
	// The caller's later journal CAS can still roll both lifecycle writes back atomically.
		await this.transaction.agentRevision.update({
		where: { id: draft.id },
		data: {
			state: AgentRevisionState.Published,
			publishedAt: command.materializedAt,
		},
		});
		await this.transaction.agentService.update({
		where: { id: service.id },
		data: {
			activeRevisionId: draft.id,
			updatedAt: command.materializedAt,
		},
		});
		return { status: AgentRevisionModelSelectionMaterializationCodes.Materialized, agentRevisionId: draft.id };
	}

	/** Resolves a public model alias with tenant scope taking precedence over the global fallback. */
	private async _ResolveModelDefinitionId(siloId: string, modelAlias: string): Promise<string | null>
	{
		const models = await this.transaction.modelDefinition.findMany({
			where: {
				publicModelName: modelAlias,
				OR: [
					{ scope: ModelRoutingScope.ClusterTenant, clusterTenant: siloId },
					{ scope: ModelRoutingScope.Global, clusterTenant: null },
				],
			},
			select: { id: true, scope: true },
		});
		const tenant = models.find(function _FindTenant(candidate)
		{
			return candidate.scope === ModelRoutingScope.ClusterTenant;
		});
		const global = models.find(function _FindGlobal(candidate)
		{
			return candidate.scope === ModelRoutingScope.Global;
		});
		return tenant?.id ?? global?.id ?? null;
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
