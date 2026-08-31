import { describe, expect, it } from "vitest";

import { ModelRoutingScope } from "@opencrane/contracts";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ProviderEffectCommandKinds, type ProviderEffectCommandPayload } from "../provider-effect-command.types";
import { _ValidateProviderEffectCommandResourceBinding } from "../provider-effect-command.validator";

describe("provider effect resource binding", function _Suite()
{
	it("accepts only the model definition named by the registration payload", function _ModelBinding()
	{
		const payload: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null, routingDefaultId: null, selectedModelDefinitionId: null } };

		expect(function _Valid() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ModelDefinition, "model-1"); }).not.toThrow();
		expect(function _WrongId() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ModelDefinition, "model-2"); }).toThrow("not bound");
		expect(function _WrongKind() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ProviderConnection, "model-1"); }).toThrow("not bound");
	});

	it("accepts only the synthetic provider connection derived from the BYOK provider", function _ProviderBinding()
	{
		const payload: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai", litellmRegistered: false, modelDefinitionIds: [], deployments: [] } };

		expect(function _Valid() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ProviderConnection, "byok:silo-1:openai"); }).not.toThrow();
		expect(function _WrongProvider() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ProviderConnection, "byok:silo-1:anthropic"); }).toThrow("not bound");
		expect(function _WrongSilo() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-2", ProductAuthorizationResourceKinds.ProviderConnection, "byok:silo-1:openai"); }).toThrow("not bound");
		expect(function _WrongKind() { _ValidateProviderEffectCommandResourceBinding(payload, "silo-1", ProductAuthorizationResourceKinds.ModelDefinition, "byok:silo-1:openai"); }).toThrow("not bound");
	});
});
