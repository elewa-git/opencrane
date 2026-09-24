import type { GeneratedOutputCapability } from "@opencrane/contracts";

/** Persisted model-definition fields required by the application service. */
export interface ModelDefinitionRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly scope: "Global" | "ClusterTenant";
	readonly clusterTenant: string | null;
	readonly publicModelName: string;
	readonly litellmModelId: string;
	readonly upstreamModel: string;
	readonly apiBase: string | null;
	readonly isDefault: boolean;
	readonly providerCredentialId: string | null;
	readonly generatedOutputCapabilities: readonly string[];
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** New pending definition persisted beside its durable registration command. */
export interface CreateModelDefinitionRecord
{
	readonly id: string;
	readonly siloId: string;
	readonly scope: "Global" | "ClusterTenant";
	readonly clusterTenant: string | null;
	readonly publicModelName: string;
	readonly litellmModelId: string;
	readonly upstreamModel: string;
	readonly apiBase: string | null;
	readonly providerCredentialId: string | null;
	readonly generatedOutputCapabilities: readonly GeneratedOutputCapability[];
}

/** Credential evidence safe to freeze into a secret-free durable command row. */
export interface ModelDefinitionCredentialRecord
{
	readonly scope: "Global" | "ClusterTenant";
	readonly clusterTenant: string | null;
	readonly secretRef: string;
	readonly litellmCredentialName: string | null;
	readonly provider: string;
}

/** Transaction-scoped persistence contract for model-definition application orchestration. */
export interface ModelDefinitionRepository
{
	/** List model definitions owned by one exact silo and optional tenant coordinate. */
	list(siloId: string, clusterTenant?: string): Promise<readonly ModelDefinitionRecord[]>;
	/** Find one model definition by its composite silo identity. */
	find(siloId: string, modelDefinitionId: string): Promise<ModelDefinitionRecord | null>;
	/** Create one pending model definition before its registration command is admitted. */
	create(record: CreateModelDefinitionRecord): Promise<ModelDefinitionRecord>;
	/** Find one provider credential by its composite silo identity. */
	findCredential(siloId: string, providerCredentialId: string): Promise<ModelDefinitionCredentialRecord | null>;
}
