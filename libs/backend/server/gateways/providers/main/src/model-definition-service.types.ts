import type { GeneratedOutputCapability, ModelDefinition, ModelRoutingScope } from "@opencrane/contracts";

import type { ProviderGatewayCaller } from "./provider-gateway-authority.types";
import type { ProviderEffectResourceBlocker } from "./provider-effect-command.types";

/** Normalized model-definition intent admitted by the durable registration service. */
export interface ValidatedModelDefinitionWrite
{
	/** Visibility of the model inside the owning silo. */
	readonly scope: ModelRoutingScope;
	/** Tenant coordinate for a tenant model, otherwise null. */
	readonly clusterTenant: string | null;
	/** Public routing name chosen by the administrator. */
	readonly publicModelName: string;
	/** Upstream provider model coordinate. */
	readonly upstreamModel: string;
	/** Optional upstream base URL. */
	readonly apiBase: string | null;
	/** Optional provider credential owned by the same silo. */
	readonly providerCredentialId: string | null;
	/** Explicit generated-output capabilities frozen into admitted runs. */
	readonly generatedOutputCapabilities: readonly GeneratedOutputCapability[];
}

/** Stable validation failure returned before model creation admits durable work. */
export interface ModelDefinitionValidationFailure
{
	/** Human-readable reason safe for the provider API response. */
	readonly error: string;
	/** Stable machine-readable reason. */
	readonly code: string;
}

/** Result of admitting and delivering one durable model registration. */
export type ModelDefinitionCreationResult =
	| { readonly status: "created"; readonly model: ModelDefinition }
	| { readonly status: "invalid"; readonly failure: ModelDefinitionValidationFailure }
	| { readonly status: "busy"; readonly blocker: ProviderEffectResourceBlocker }
	| { readonly status: "pending"; readonly commandId: string; readonly modelDefinitionId: string };

/** Result of retrying the exact durable registration command returned by creation. */
export type ModelDefinitionRegistrationResult =
	| { readonly status: "completed"; readonly model: ModelDefinition }
	| { readonly status: "pending"; readonly commandId: string; readonly modelDefinitionId: string };

/** Model-definition application boundary used by the request-only Express router. */
export interface ModelDefinitionService
{
	/** List exact model definitions the caller may read. */
	list(caller: ProviderGatewayCaller, clusterTenant?: string): Promise<readonly ModelDefinition[]>;
	/** Read one exact model definition when the caller may read it. */
	get(caller: ProviderGatewayCaller, modelDefinitionId: string): Promise<ModelDefinition | null>;
	/** Admit and deliver one durable model registration. */
	create(caller: ProviderGatewayCaller, value: unknown): Promise<ModelDefinitionCreationResult>;
	/** Retry the exact durable registration command returned by creation. */
	resume(caller: ProviderGatewayCaller, modelDefinitionId: string, commandId: string): Promise<ModelDefinitionRegistrationResult>;
}

/** Stable refusal used until update and unregister have their own durable external-effect commands. */
export const MODEL_DEFINITION_MUTATION_GOVERNED = Object.freeze({
	error: "Model definition updates and deletion require a durable provider command.",
	code: "MODEL_DEFINITION_GOVERNED",
});
