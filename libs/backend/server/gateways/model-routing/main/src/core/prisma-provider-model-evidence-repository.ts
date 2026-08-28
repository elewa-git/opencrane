import type { Prisma } from "@prisma/client";

import type { CreateGlobalProviderModelCommand, ProviderModelEvidenceRepository, UpdateProviderModelCommand } from "./provider-model-evidence-repository.types";

/**
 * Persists Global model definitions and checks whether AgentRevision evidence has frozen them.
 *
 * The adapter keeps all ModelDefinition and AgentRevision delegates outside the bootstrap
 * coordinator. Callers receive only the fields required for live registration reconciliation.
 *
 * Called by: `_ProvisionByokKey`, which supplies it to `_EnsureProviderModels`.
 * @implements {ProviderModelEvidenceRepository}
 */
export class PrismaProviderModelEvidenceRepository implements ProviderModelEvidenceRepository
{
	/** Transaction-capable Prisma client supplied by the provider-custody composition. */
	private readonly prisma: Prisma.TransactionClient;

	/** Binds model projection and evidence reads to the caller's Prisma client. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Finds one Global model definition by public name. */
	findGlobalByPublicName(publicModelName: string)
	{
		return this.prisma.modelDefinition.findFirst({
			where: {
				scope: "Global",
				clusterTenant: null,
				publicModelName,
			},
		});
	}

	/** Lists enough Global defaults to detect an ambiguous legacy catalogue. */
	listGlobalDefaults()
	{
		return this.prisma.modelDefinition.findMany({
			where: {
				scope: "Global",
				clusterTenant: null,
				isDefault: true,
			},
			orderBy: { id: "asc" },
			take: 2,
		});
	}

	/** Creates one Global provider-backed definition. */
	createGlobal(command: CreateGlobalProviderModelCommand)
	{
		return this.prisma.modelDefinition.create({
			data: {
				scope: "Global",
				clusterTenant: null,
				publicModelName: command.publicModelName,
				litellmModelId: command.litellmModelId,
				upstreamModel: command.upstreamModel,
				apiBase: command.apiBase,
				isDefault: command.isDefault,
				providerCredentialId: command.providerCredentialId,
			},
		});
	}

	/** Updates only the bootstrap-owned mutable fields. */
	update(id: string, command: UpdateProviderModelCommand)
	{
		return this.prisma.modelDefinition.update({
			where: { id },
			data: command,
		});
	}

	/** Checks whether any immutable revision already references the definition. */
	async isReferencedByAgentRevision(id: string): Promise<boolean>
	{
		const referenced = await this.prisma.agentRevision.findFirst({
			where: { modelDefinitionId: id },
			select: { id: true },
		});
		return referenced !== null;
	}
}
