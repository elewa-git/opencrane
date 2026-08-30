import { z } from "zod";

import { ModelRoutingScope } from "@opencrane/contracts";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ProviderEffectCommandKinds, type ProviderEffectCommandPayload } from "./provider-effect-command.types";

// Database JSON crosses a runtime trust boundary here, so this validator changes with the typed
// provider-effect payload and refuses fields an executor does not understand.
/** Validates the non-secret payload for a Set-BYOK command. */
const _SET_BYOK_PAYLOAD = z.object({ provider: z.string().min(1), secretRef: z.string().min(1), litellmCredentialName: z.string().min(1) }).strict();
/** Validates the non-secret payload for a Delete-BYOK command. */
const _DELETE_BYOK_PAYLOAD = z.object({ provider: z.string().min(1), secretRef: z.string().min(1), litellmCredentialName: z.string().min(1) }).strict();
/** Validates the non-secret payload for a model-registration command. */
const _REGISTER_MODEL_PAYLOAD = z.object({ modelDefinitionId: z.string().min(1), publicModelName: z.string().min(1), upstreamModel: z.string().min(1), scope: z.nativeEnum(ModelRoutingScope), clusterTenant: z.string().min(1).nullable(), apiBase: z.string().min(1).nullable(), apiKeyEnvRef: z.string().min(1).nullable(), litellmCredentialName: z.string().min(1).nullable() }).strict();

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
 * Refuses a command whose typed payload names a different governed resource than its claim.
 *
 * Called by: {@link PrismaProviderEffectCommandRepository} during admission and database reads.
 *
 * @param payload - Parsed closed provider-effect payload.
 * @param resourceKind - Central authorization resource kind bound to the command.
 * @param resourceId - Central authorization resource id bound to the command.
 * @throws When payload and authorization coordinates do not identify the same resource.
 */
export function _ValidateProviderEffectCommandResourceBinding(payload: ProviderEffectCommandPayload, resourceKind: string, resourceId: string): void
{
	if (payload.kind === ProviderEffectCommandKinds.RegisterModel)
	{
		if (resourceKind !== ProductAuthorizationResourceKinds.ModelDefinition || resourceId !== payload.value.modelDefinitionId)
			throw new Error("model registration command is not bound to its model-definition resource");
		return;
	}
	if (resourceKind !== ProductAuthorizationResourceKinds.ProviderConnection || resourceId !== `byok:${payload.value.provider}`)
		throw new Error("BYOK command is not bound to its provider-connection resource");
}
