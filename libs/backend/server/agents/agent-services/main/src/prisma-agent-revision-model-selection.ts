import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";

import { AgentRevisionModelSelectionMaterializationCodes, type AgentRevisionModelSelectionRepository, type MaterializeAgentRevisionModelSelectionCommand, type MaterializeAgentRevisionModelSelectionResult } from "./agent-revision-model-selection.types.js";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer.js";

/**
 * Prisma strategy for model-selection changes inside an owning unit of work.
 *
 * The caller provides a Serializable transaction. This strategy proves that the personal revision
 * the owner reviewed is still active, changes only its registered model definition, then prepares
 * and activates the next immutable revision. The surrounding personal-configuration Unit of Work
 * retains transaction ownership so its proposal journal transition can commit or roll back with
 * these writes.
 */
export class PrismaAgentRevisionModelSelectionRepository implements AgentRevisionModelSelectionRepository
{
	/** Transaction-scoped ORM client supplied only by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the transaction-scoped model-selection strategy. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Revalidates, clones, publishes, and activates one selected-model revision. */
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
		const modelDefinitionId = await this._ResolveModelDefinitionId(command.siloId, command.modelAlias);
		if (modelDefinitionId === null)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable };
		}

		// 5. Reconstruct one canonical content value and append the next immutable draft.
		// Agent-services alone chooses revision lineage and represents that content in Prisma.
		const content: AgentRevisionContent = {
			..._AgentRevisionContentFromRow(source),
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
