import { GeneratedOutputCapability, ModelRoutingScope } from "@opencrane/contracts";

import { _BYOK_PROVIDER_CATALOG } from "@opencrane/backend/server/gateways/model-routing";

import { _GLOBAL_AUTO_EMBEDDING_MODEL_NAME, _GLOBAL_AUTO_MODEL_NAME } from "./prisma-global-model-alias-repository";
import type { ModelDefinitionValidationFailure, ValidatedModelDefinitionWrite } from "./model-definition-service.types";

/** Validate and normalize one untrusted model-definition creation body. */
export function _ValidateModelDefinitionWrite(value: unknown): ValidatedModelDefinitionWrite | ModelDefinitionValidationFailure
{
	const body = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
	const publicModelName = typeof body.publicModelName === "string" ? body.publicModelName.trim() : "";
	const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
	if (!publicModelName || !upstreamModel)
		return { error: "publicModelName and upstreamModel are required.", code: "VALIDATION_ERROR" };
	if (publicModelName === _GLOBAL_AUTO_MODEL_NAME || publicModelName === _GLOBAL_AUTO_EMBEDDING_MODEL_NAME)
		return { error: "publicModelName is reserved for centrally governed routing.", code: "MODEL_NAME_RESERVED" };

	const scope = body.scope ?? ModelRoutingScope.Global;
	if (scope !== ModelRoutingScope.Global && scope !== ModelRoutingScope.ClusterTenant)
		return { error: "scope must be 'global' or 'clusterTenant'.", code: "VALIDATION_ERROR" };
	if (body.isDefault === true)
		return { error: "Defaults must be selected through model routing defaults.", code: "GLOBAL_MODEL_DEFAULT_GOVERNED" };
	if (body.isDefault !== undefined && body.isDefault !== false)
		return { error: "isDefault must be false or omitted.", code: "VALIDATION_ERROR" };
	if (scope === ModelRoutingScope.Global && _ReservedProviderModel(publicModelName))
		return { error: "publicModelName is reserved for provider catalogue reconciliation.", code: "MODEL_NAME_RESERVED" };

	if (body.clusterTenant !== undefined && body.clusterTenant !== null && typeof body.clusterTenant !== "string")
		return { error: "clusterTenant must be a string when supplied.", code: "VALIDATION_ERROR" };
	const clusterTenant = scope === ModelRoutingScope.ClusterTenant && typeof body.clusterTenant === "string" ? body.clusterTenant.trim() : null;
	if (scope === ModelRoutingScope.ClusterTenant && !clusterTenant)
		return { error: "clusterTenant is required when scope is 'clusterTenant'.", code: "VALIDATION_ERROR" };
	if (body.apiBase !== undefined && body.apiBase !== null && typeof body.apiBase !== "string")
		return { error: "apiBase must be a string or null when supplied.", code: "VALIDATION_ERROR" };
	if (body.providerCredentialId !== undefined && body.providerCredentialId !== null && typeof body.providerCredentialId !== "string")
		return { error: "providerCredentialId must be a string or null when supplied.", code: "VALIDATION_ERROR" };
	const generatedOutputCapabilities = body.generatedOutputCapabilities ?? [];
	if (!Array.isArray(generatedOutputCapabilities) || generatedOutputCapabilities.some(_UnsupportedCapability))
		return { error: "generatedOutputCapabilities contains an unsupported capability.", code: "VALIDATION_ERROR" };

	return {
		scope,
		clusterTenant,
		publicModelName,
		upstreamModel,
		apiBase: typeof body.apiBase === "string" ? body.apiBase.trim() || null : null,
		providerCredentialId: typeof body.providerCredentialId === "string" ? body.providerCredentialId.trim() || null : null,
		generatedOutputCapabilities: generatedOutputCapabilities as GeneratedOutputCapability[],
	};
}

/** Return whether a global public name belongs to provider catalogue reconciliation. */
function _ReservedProviderModel(publicModelName: string): boolean
{
	return Object.values(_BYOK_PROVIDER_CATALOG).some(function _Reserved(catalog)
	{
		return catalog.models.some(function _Model(model) { return model.slug === publicModelName; }) || catalog.embeddingModel?.slug === publicModelName;
	});
}

/** Return whether a generated-output capability is outside the supported explicit allowlist. */
function _UnsupportedCapability(capability: unknown): boolean
{
	return capability !== GeneratedOutputCapability.ImagePng && capability !== GeneratedOutputCapability.CodeExecutionFiles;
}
