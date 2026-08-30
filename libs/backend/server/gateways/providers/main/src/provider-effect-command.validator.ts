import { z } from "zod";

import { ModelRoutingScope } from "@opencrane/contracts";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ProviderEmbeddingReconciliationStatuses } from "@opencrane/backend/server/gateways/model-routing";

import { ProviderEffectCommandKinds, type ProviderEffectCommandPayload, type ProviderEffectHandlerResult } from "./provider-effect-command.types";
import { _ByokProviderConnectionId } from "./provider-resource-identity";

// Database JSON crosses a runtime trust boundary here, so this validator changes with the typed
// provider-effect payload and refuses fields an executor does not understand.
/** Validates the non-secret payload for a Set-BYOK command. */
const _SET_BYOK_PAYLOAD = z.object({ provider: z.string().min(1), secretRef: z.string().min(1), litellmCredentialName: z.string().min(1) }).strict();
/** Validates one LiteLLM deployment whose identity and coordinates were frozen at admission. */
const _LITELLM_DEPLOYMENT_TARGET = z.object({ deploymentId: z.string().min(1), publicModelName: z.string().min(1), upstreamModel: z.string().min(1), apiBase: z.string().min(1).nullable(), apiKeyReference: z.string().min(1).nullable(), litellmCredentialName: z.string().min(1).nullable(), mode: z.enum(["chat", "embedding"]) }).strict();
/** Validates the non-secret payload for a Delete-BYOK command. */
const _DELETE_BYOK_PAYLOAD = z.object({ provider: z.string().min(1), secretRef: z.string().min(1), litellmCredentialName: z.string().min(1), litellmRegistered: z.boolean(), modelDefinitionIds: z.array(z.string().min(1)), deployments: z.array(_LITELLM_DEPLOYMENT_TARGET) }).strict();
/** Validates the non-secret payload for a model-registration command. */
const _REGISTER_MODEL_PAYLOAD = z.object({ modelDefinitionId: z.string().min(1), publicModelName: z.string().min(1), upstreamModel: z.string().min(1), scope: z.nativeEnum(ModelRoutingScope), clusterTenant: z.string().min(1).nullable(), apiBase: z.string().min(1).nullable(), apiKeyEnvRef: z.string().min(1).nullable(), litellmCredentialName: z.string().min(1).nullable(), routingDefaultId: z.string().min(1).nullable(), selectedModelDefinitionId: z.string().min(1).nullable() }).strict().refine(function _CompleteAliasBinding(value) { return (value.routingDefaultId === null) === (value.selectedModelDefinitionId === null); }, { message: "routing default and selected model bindings must be supplied together" });
/** Validates one secret-free model deployment projection. */
const _MODEL_PROJECTION = z.object({ publicModelName: z.string().min(1), upstreamModel: z.string().min(1), litellmModelId: z.string().min(1) }).strict();
/** Validates the closed embedding evidence stored after external provider delivery. */
const _EMBEDDING_RESULT = z.discriminatedUnion("status", [
	z.object({ status: z.literal(ProviderEmbeddingReconciliationStatuses.NotApplicable), deployments: z.tuple([]) }).strict(),
	z.object({ status: z.literal(ProviderEmbeddingReconciliationStatuses.Skipped), deployments: z.tuple([]) }).strict(),
	z.object({ status: z.literal(ProviderEmbeddingReconciliationStatuses.Confirmed), deployments: z.array(_MODEL_PROJECTION) }).strict(),
]);
/** Validates the closed, secret-free result saved after an external effect. */
const _HANDLER_RESULT = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(ProviderEffectCommandKinds.SetByokKey), provider: z.string().min(1), secretRef: z.string().min(1), litellmCredentialName: z.string().min(1).nullable(), models: z.array(_MODEL_PROJECTION), embedding: _EMBEDDING_RESULT }).strict(),
	z.object({ kind: z.literal(ProviderEffectCommandKinds.DeleteByokKey), provider: z.string().min(1) }).strict(),
	z.object({ kind: z.literal(ProviderEffectCommandKinds.RegisterModel), litellmModelId: z.string().min(1) }).strict(),
]);

/**
 * Parses saved provider-effect JSON under its persisted command kind.
 *
 * Called by: {@link PrismaProviderEffectCommandRepository} before any executor can consume a row.
 *
 * @param kind - Closed command discriminator stored in PostgreSQL.
 * @param value - Untrusted JSON payload read from PostgreSQL.
 * @returns The matching typed payload.
 * @throws A Zod validation error when the row is malformed or the kind is unknown.
 */
export function _ParseProviderEffectCommandPayload(kind: ProviderEffectCommandKinds, value: unknown): ProviderEffectCommandPayload
{
	switch (kind)
	{
		case ProviderEffectCommandKinds.SetByokKey:
			return { kind, value: _SET_BYOK_PAYLOAD.parse(value) };
		case ProviderEffectCommandKinds.DeleteByokKey:
			return { kind, value: _DELETE_BYOK_PAYLOAD.parse(value) };
		case ProviderEffectCommandKinds.RegisterModel:
			return { kind, value: _REGISTER_MODEL_PAYLOAD.parse(value) };
	}
}

/**
 * Parses durable external-effect evidence before recovery or projection can consume it.
 *
 * Called by: {@link PrismaProviderEffectCommandRepository} for every command row carrying a result.
 *
 * @param value - Untrusted JSON result read from PostgreSQL.
 * @returns A closed, secret-free provider handler result.
 * @throws A Zod validation error when persisted evidence is malformed.
 */
export function _ParseProviderEffectHandlerResult(value: unknown): ProviderEffectHandlerResult
{
	return _HANDLER_RESULT.parse(value) as ProviderEffectHandlerResult;
}

/**
 * Refuses a command whose typed payload names a different governed resource than its claim.
 *
 * Called by: {@link PrismaProviderEffectCommandRepository} during admission and database reads.
 *
 * @param payload - Parsed closed provider-effect payload.
 * @param siloId - Silo that owns the command and its provider resource identity.
 * @param resourceKind - Central authorization resource kind bound to the command.
 * @param resourceId - Central authorization resource id bound to the command.
 * @throws When payload and authorization coordinates do not identify the same resource.
 */
export function _ValidateProviderEffectCommandResourceBinding(payload: ProviderEffectCommandPayload, siloId: string, resourceKind: string, resourceId: string): void
{
	if (payload.kind === ProviderEffectCommandKinds.RegisterModel)
	{
		if (resourceKind !== ProductAuthorizationResourceKinds.ModelDefinition || resourceId !== payload.value.modelDefinitionId)
			throw new Error("model registration command is not bound to its model-definition resource");
		return;
	}
	if (payload.kind === ProviderEffectCommandKinds.DeleteByokKey)
	{
		const modelIds = new Set(payload.value.modelDefinitionIds);
		const deploymentIds = new Set(payload.value.deployments.map(deployment => deployment.deploymentId));
		const deploymentNames = new Set(payload.value.deployments.map(deployment => deployment.publicModelName));
		if (modelIds.size !== payload.value.modelDefinitionIds.length || deploymentIds.size !== payload.value.deployments.length || deploymentNames.size !== payload.value.deployments.length)
			throw new Error("provider retirement command contains duplicate product or LiteLLM targets");
		if (!payload.value.litellmRegistered && payload.value.deployments.length !== 0)
			throw new Error("provider retirement command cannot delete LiteLLM deployments for an unregistered credential");
		if (payload.value.deployments.some(deployment => deployment.litellmCredentialName !== payload.value.litellmCredentialName))
			throw new Error("provider retirement deployment uses a different LiteLLM credential");
	}
	if (resourceKind !== ProductAuthorizationResourceKinds.ProviderConnection || resourceId !== _ByokProviderConnectionId(siloId, payload.value.provider))
		throw new Error("BYOK command is not bound to its provider-connection resource");
}
