import type { Prisma } from "@prisma/client";

import { _BYOK_PROVIDER_CATALOG, _ProviderEmbeddingDeploymentTargets, _byokCredentialName, type LiteLlmModelDeploymentTarget } from "@opencrane/backend/server/gateways/model-routing";

import { ProviderRetirementPlanStatuses, type ProviderByokRepository, type ProviderByokStatusRecord, type ProviderRetirementPlan } from "./provider-byok-repository.types";
import type { DeleteByokKeyEffectPayload } from "./provider-effect-command.types";
import { _GLOBAL_AUTO_MODEL_NAME } from "./prisma-global-model-alias-repository";

/** Owns provider status reads and retirement eligibility inside the caller's transaction. */
export class PrismaProviderByokRepository implements ProviderByokRepository
{
	/** Transaction that also owns the command admission and central authorization decision. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds every provider read to the caller's authorization transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async listStatuses(siloId: string, providers: readonly string[]): Promise<readonly ProviderByokStatusRecord[]>
	{
		return this.transaction.providerCredential.findMany({ where: { siloId, scope: "Global", clusterTenant: null, provider: { in: [...providers] } }, select: { id: true, siloId: true, provider: true, litellmCredentialName: true, updatedAt: true } });
	}

	/** @inheritdoc */
	async findStatus(siloId: string, providerConnectionId: string): Promise<ProviderByokStatusRecord | null>
	{
		return this.transaction.providerCredential.findUnique({ where: { id_siloId: { id: providerConnectionId, siloId } }, select: { id: true, siloId: true, provider: true, litellmCredentialName: true, updatedAt: true } });
	}

	/** @inheritdoc */
	async planRetirement(siloId: string, provider: string): Promise<ProviderRetirementPlan>
	{
		const credential = await this.transaction.providerCredential.findFirst({ where: { siloId, scope: "Global", clusterTenant: null, provider }, select: { id: true, litellmCredentialName: true, updatedAt: true } });
		if (credential === null)
			return { status: ProviderRetirementPlanStatuses.Ready, reason: null, credentialUpdatedAt: null, litellmRegistered: false, modelDefinitionIds: [], deployments: [] };
		const models = await this.transaction.modelDefinition.findMany({
			where: { siloId, providerCredentialId: credential.id },
			select: { id: true, publicModelName: true, upstreamModel: true, litellmModelId: true, apiBase: true, isDefault: true, agentRevisions: { select: { id: true }, take: 1 } },
			orderBy: { id: "asc" },
		});
		if (models.some(model => model.publicModelName === _GLOBAL_AUTO_MODEL_NAME || model.isDefault || model.agentRevisions.length > 0))
			return { status: ProviderRetirementPlanStatuses.Governed, reason: "The provider still owns a frozen agent model or a selected alias." };
		const publicModelNames = models.map(model => model.publicModelName);
		if (publicModelNames.length > 0)
		{
			const selected = await this.transaction.modelRoutingDefault.findFirst({ where: { siloId, defaultModel: { in: publicModelNames } }, select: { id: true } });
			if (selected !== null)
				return { status: ProviderRetirementPlanStatuses.Governed, reason: "The provider supplies a selected routing default; choose a replacement before deleting its key." };
		}
		const litellmRegistered = credential.litellmCredentialName !== null;
		const fixedCredentialName = _byokCredentialName(provider);
		if (litellmRegistered && credential.litellmCredentialName !== fixedCredentialName)
			throw new Error("provider retirement found a credential name outside the fixed catalogue");
		const chatDeployments = litellmRegistered ? models.map(function _Deployment(model): LiteLlmModelDeploymentTarget
		{
			if (model.litellmModelId.startsWith("placeholder:") || model.litellmModelId.startsWith("pending:"))
				throw new Error("provider retirement found an unconfirmed LiteLLM deployment id");
			return { deploymentId: model.litellmModelId, publicModelName: model.publicModelName, upstreamModel: model.upstreamModel, apiBase: model.apiBase, apiKeyReference: null, litellmCredentialName: fixedCredentialName, mode: "chat" };
		}) : [];
		const embeddingDeployments = litellmRegistered ? _ProviderEmbeddingDeploymentTargets(_BYOK_PROVIDER_CATALOG[provider], fixedCredentialName) : [];
		return {
			status: ProviderRetirementPlanStatuses.Ready,
			reason: null,
			credentialUpdatedAt: credential.updatedAt,
			litellmRegistered,
			modelDefinitionIds: models.map(model => model.id),
			deployments: [...chatDeployments, ...embeddingDeployments],
		};
	}

	/** @inheritdoc */
	async isRetirementEligible(siloId: string, payload: DeleteByokKeyEffectPayload): Promise<boolean>
	{
		const plan = await this.planRetirement(siloId, payload.provider);
		if (plan.status !== ProviderRetirementPlanStatuses.Ready)
			return false;
		return plan.litellmRegistered === payload.litellmRegistered
			&& _sameStrings(plan.modelDefinitionIds, payload.modelDefinitionIds)
			&& _sameDeploymentTargets(plan.deployments, payload.deployments);
	}

	/** @inheritdoc */
	async persistRetirement(siloId: string, payload: DeleteByokKeyEffectPayload): Promise<void>
	{
		const credential = await this.transaction.providerCredential.findFirst({ where: { siloId, scope: "Global", clusterTenant: null, provider: payload.provider }, select: { id: true } });
		if (credential === null)
		{
			if (payload.modelDefinitionIds.length !== 0)
				throw new Error("provider retirement lost its credential before model finalization");
			return;
		}
		const deletedModels = await this.transaction.modelDefinition.deleteMany({ where: { siloId, providerCredentialId: credential.id, id: { in: [...payload.modelDefinitionIds] } } });
		if (deletedModels.count !== payload.modelDefinitionIds.length)
			throw new Error("provider retirement did not delete its exact model-definition set");
		const deletedCredential = await this.transaction.providerCredential.deleteMany({ where: { id: credential.id, siloId, scope: "Global", clusterTenant: null, provider: payload.provider } });
		if (deletedCredential.count !== 1)
			throw new Error("provider retirement did not delete its exact provider credential");
	}
}

/** Compares string sets after sorting copies so input order grants no authority. */
function _sameStrings(left: readonly string[], right: readonly string[]): boolean
{
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

/** Compares deployment targets as complete coordinate records in a stable order. */
function _sameDeploymentTargets(left: readonly LiteLlmModelDeploymentTarget[], right: readonly LiteLlmModelDeploymentTarget[]): boolean
{
	const sortTargets = function _Sort(targets: readonly LiteLlmModelDeploymentTarget[]): readonly LiteLlmModelDeploymentTarget[]
	{
		return [...targets].sort(function _Compare(first, second) { return first.deploymentId.localeCompare(second.deploymentId); });
	};
	return JSON.stringify(sortTargets(left)) === JSON.stringify(sortTargets(right));
}
