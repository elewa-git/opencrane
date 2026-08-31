import { randomUUID } from "node:crypto";

import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, PersonaRevisionState, type Prisma } from "@prisma/client";

import type { AgentRevisionContent } from "@opencrane/models/agents";

import { AgentRevisionModelSelectionMaterializationCodes, type AgentRevisionModelSelectionRepository, type MaterializeAgentRevisionModelSelectionCommand, type MaterializeAgentRevisionModelSelectionResult } from "../agent-revision-model-selection.types";
import { PersonalAgentSelectedResourceKinds, type PersonalAgentProductEffects } from "../personal-agent-product-effects.types";
import { PrismaPersonalAgentProductEffectsAuthority } from "../prisma-personal-agent-product-effects";
import { _AGENT_REVISION_INCLUDE, _AgentRevisionContentFromRow, PrismaAgentRevisionWriterRepository } from "./prisma-agent-revision-writer";

/**
 * Prisma strategy for model-selection changes inside an owning unit of work.
 *
 * The caller opens the transaction at Serializable isolation and keeps ownership of it. This class
 * re-checks that the revision the owner reviewed is still the active one, copies it with only the
 * model changed, then publishes and activates the copy — all without committing. The caller commits,
 * so its own proposal-journal update either lands with these writes or rolls back with them.
 *
 * Called by:
 * libs/backend/agents/personal/configuration/main/src/materialization/prisma-personal-configuration-materialization-unit-of-work.ts.
 */
export class PrismaAgentRevisionModelSelectionRepository implements AgentRevisionModelSelectionRepository
{
	/** Transaction-scoped ORM client supplied only by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;
	/** Shared product-effect adapter bound to the owning transaction. */
	private readonly productEffects: PersonalAgentProductEffects;

	/** Creates the transaction-scoped model-selection strategy. */
	constructor(transaction: Prisma.TransactionClient, productEffects: PersonalAgentProductEffects | null = null)
	{
		this.transaction = transaction;
		this.productEffects = productEffects ?? new PrismaPersonalAgentProductEffectsAuthority(transaction);
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
				siloId: command.siloId,
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
			where: { agentServiceId: service.id, siloId: command.siloId },
			orderBy: { revision: "desc" },
			select: { id: true },
		});
		if (latest?.id !== source.id)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.StaleSource };
		}

		// 4. Only now look up the model, after all three staleness checks have passed.
		// A silo's own model wins over a global one with the same public name, and the provider's model
		// id stays server-side — the owner only ever names the public alias.
		const modelDefinitionId = await this._ResolveModelDefinitionId(command.siloId, command.modelAlias);
		if (modelDefinitionId === null)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.ModelUnavailable };
		}
		const caller = await this.productEffects.resolveCaller(command.siloId, command.authoredBy);
		if (caller === null || source.personaRevisionId === null)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.Unauthorized };
		}
		const persona = await this.transaction.personaRevision.findFirst({
			where: { id: source.personaRevisionId, state: PersonaRevisionState.Approved, approvedAt: { not: null }, profile: { is: { siloId: command.siloId, userId: command.authoredBy } } },
			select: { personaProfileId: true },
		});
		if (persona === null)
		{
			return { status: AgentRevisionModelSelectionMaterializationCodes.Unauthorized };
		}

		// 5. Preallocate the successor and admit through the existing service and selected model.
		const agentRevisionId = randomUUID();
		const productCommand = {
			caller,
			source: { agentServiceId: service.id, agentRevisionId: source.id, personaProfileId: persona.personaProfileId, modelDefinitionId: source.modelDefinitionId },
			target: { agentServiceId: service.id, agentRevisionId, personaProfileId: persona.personaProfileId, modelDefinitionId },
			now: command.materializedAt,
			selectedResource: PersonalAgentSelectedResourceKinds.Model,
			argumentsValue: { agentServiceId: command.agentServiceId, sourceRevisionId: source.id, targetModelDefinitionId: modelDefinitionId, modelAlias: command.modelAlias, materializedAt: command.materializedAt.toISOString() },
		};
		await this.productEffects.admitRevisionSelection(productCommand);

		// 6. Copy the source revision's content with only the model changed, and append it as a new draft.
		// Revision numbering and the Prisma mapping stay in this package so no other package can
		// reproduce them and drift.
		const content: AgentRevisionContent = {
			..._AgentRevisionContentFromRow(source),
			modelDefinitionId,
		};
		const cmd = {
			agentRevisionId,
			siloId: command.siloId,
			agentServiceId: command.agentServiceId,
			revision: source.revision + 1,
			parentRevisionId: source.id,
			sourceRevisionId: null,
			content,
			changeMessage: command.changeMessage,
			authoredBy: command.authoredBy,
			createdAt: command.materializedAt,
		};
		const task = new PrismaAgentRevisionWriterRepository(this.transaction);
		const draft = await task.createDraft(cmd);

		// 7. Project the successor's exact grants after persistence, then admit publication.
		await this.productEffects.admitRevisionPublication(productCommand);

		// 8. Mark the draft published, then point the service at it — both still inside the caller's
		// transaction and uncommitted. If the caller's own check later fails, both writes roll back
		// together, so the service can never end up active on an unpublished revision.
		await this.transaction.agentRevision.update({
			where: { id_siloId: { id: draft.id, siloId: command.siloId } },
			data: {
				state: AgentRevisionState.Published,
				publishedAt: command.materializedAt,
			},
		});
		await this.transaction.agentService.update({
			where: { id_siloId: { id: service.id, siloId: command.siloId } },
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
				siloId,
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
