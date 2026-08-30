import { describe, expect, it } from "vitest";

import { ModelRoutingScope } from "@opencrane/contracts";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { ProviderEffectCommandKinds, type ProviderEffectCommandPayload } from "../provider-effect-command.types";
import { _ValidateProviderEffectCommandResourceBinding } from "../provider-effect-command.validator";

describe("provider effect resource binding", function _Suite()
{
	it("accepts only the model definition named by the registration payload", function _ModelBinding()
	{
		const payload: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-1", publicModelName: "openai/gpt", upstreamModel: "openai/gpt", scope: ModelRoutingScope.Global, clusterTenant: null, apiBase: null, apiKeyEnvRef: null, litellmCredentialName: null } };

		expect(function _Valid() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ModelDefinition, "model-1"); }).not.toThrow();
		expect(function _WrongId() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ModelDefinition, "model-2"); }).toThrow("not bound");
		expect(function _WrongKind() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ProviderConnection, "model-1"); }).toThrow("not bound");
	});

	it("accepts only the synthetic provider connection derived from the BYOK provider", function _ProviderBinding()
	{
		const payload: ProviderEffectCommandPayload = { kind: ProviderEffectCommandKinds.DeleteByokKey, value: { provider: "openai", secretRef: "byok-provider-key-openai", litellmCredentialName: "byok-openai" } };

		expect(function _Valid() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ProviderConnection, "byok:openai"); }).not.toThrow();
		expect(function _WrongProvider() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ProviderConnection, "byok:anthropic"); }).toThrow("not bound");
		expect(function _WrongKind() { _ValidateProviderEffectCommandResourceBinding(payload, ProductAuthorizationResourceKinds.ModelDefinition, "byok:openai"); }).toThrow("not bound");
	});
});
