import type { Prisma } from "@prisma/client";

import type { CreateModelDefinitionRecord, ModelDefinitionCredentialRecord, ModelDefinitionRecord, ModelDefinitionRepository } from "./model-definition-repository.types";

/** Prisma adapter that owns model-definition and backing-credential delegates in one transaction. */
export class PrismaModelDefinitionRepository implements ModelDefinitionRepository
{
	/** Transaction supplied by the authorization-bound model-definition unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Bind model persistence to the caller's open transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	list(siloId: string, clusterTenant?: string): Promise<readonly ModelDefinitionRecord[]>
	{
		return this.transaction.modelDefinition.findMany({ where: { siloId, ...(clusterTenant ? { clusterTenant } : {}) }, orderBy: { createdAt: "asc" } });
	}

	/** @inheritdoc */
	find(siloId: string, modelDefinitionId: string): Promise<ModelDefinitionRecord | null>
	{
		return this.transaction.modelDefinition.findUnique({ where: { id_siloId: { id: modelDefinitionId, siloId } } });
	}

	/** @inheritdoc */
	create(record: CreateModelDefinitionRecord): Promise<ModelDefinitionRecord>
	{
		return this.transaction.modelDefinition.create({ data: { ...record, generatedOutputCapabilities: [...record.generatedOutputCapabilities], isDefault: false } });
	}

	/** @inheritdoc */
	findCredential(siloId: string, providerCredentialId: string): Promise<ModelDefinitionCredentialRecord | null>
	{
		return this.transaction.providerCredential.findUnique({ where: { id_siloId: { id: providerCredentialId, siloId } }, select: { scope: true, clusterTenant: true, secretRef: true, litellmCredentialName: true, provider: true } });
	}
}
