import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";

import { ModelProvider, ProviderKeyGateway, ProviderKeyStatus } from "./provider-key-gateway.types";

/**
 * Wire shape of a BYOK key status as returned by the OpenCrane opencrane-ui API.
 *
 * Mirrors the pinned contract's `ByokProviderKeyStatus` schema locally; the
 * `provider` field is a closed enum, narrowed onto {@link ModelProvider} on map.
 */
interface ProviderKeyStatusWire
{
	/** The provider this status describes (closed enum in the contract). */
	provider: string;

	/** Whether a key is currently set for this provider in this silo. */
	configured: boolean;

	/** Whether LiteLLM accepted the key on its dynamic path. */
	litellmRegistered: boolean;

	/** When the key was last set; null/absent when not configured. */
	updatedAt?: string | null;
}

/**
 * Live ProviderKeyGateway backed by the OpenCrane opencrane-ui API.
 *
 * Issues typed GET/PUT/DELETE through the shared `ControlPlaneApiService` (the
 * openapi-fetch client generated from the pinned contract) against
 * `/providers/byok` and `/providers/byok/{provider}`, mapping each response onto
 * the {@link ProviderKeyStatus} read model. WeOwnAI never imports OpenCrane
 * source; this network contract is the only coupling.
 *
 * Bound in the OpenCrane UI live profile by {@link provideOpenCraneUiLiveGateways}.
 */
@Injectable()
export class OpenCraneProviderKeyGateway implements ProviderKeyGateway
{
	/** Typed OpenCrane opencrane-ui client. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async list(): Promise<ProviderKeyStatus[]>
	{
		const { data, error } = await this._api.client.GET("/providers/byok");
		if (error || !data)
		{
			throw new Error(this._errorMessage(error, "failed to list provider keys"));
		}
		return (data as ProviderKeyStatusWire[]).map(this._mapStatus.bind(this));
	}

	/** @inheritdoc */
	public async setKey(provider: ModelProvider, apiKey: string): Promise<ProviderKeyStatus>
	{
		const { data, error } = await this._api.client.PUT("/providers/byok/{provider}", {
			params: { path: { provider } },
			body: { apiKey }
		});
		if (error || !data)
		{
			throw new Error(this._errorMessage(error, `failed to set ${provider} key`));
		}
		return this._mapStatus(data as ProviderKeyStatusWire);
	}

	/** @inheritdoc */
	public async deleteKey(provider: ModelProvider): Promise<void>
	{
		const { error } = await this._api.client.DELETE("/providers/byok/{provider}", {
			params: { path: { provider } }
		});
		if (error)
		{
			throw new Error(this._errorMessage(error, `failed to remove ${provider} key`));
		}
	}

	/** Map a wire status onto the read model, narrowing the provider enum. */
	private _mapStatus(wire: ProviderKeyStatusWire): ProviderKeyStatus
	{
		return {
			provider: this._mapProvider(wire.provider),
			configured: wire.configured,
			litellmRegistered: wire.litellmRegistered,
			updatedAt: wire.updatedAt ?? null
		};
	}

	/** Narrow a wire provider string onto the enum, defaulting to OpenAI when unknown. */
	private _mapProvider(provider: string): ModelProvider
	{
		switch (provider)
		{
			case ModelProvider.Anthropic:
				return ModelProvider.Anthropic;
			case ModelProvider.Gemini:
				return ModelProvider.Gemini;
			case ModelProvider.Mistral:
				return ModelProvider.Mistral;
			case ModelProvider.DeepSeek:
				return ModelProvider.DeepSeek;
			case ModelProvider.Glm:
				return ModelProvider.Glm;
			default:
				return ModelProvider.OpenAi;
		}
	}

	/** Build a user-facing message from the API error payload, falling back to `fallback`.
	 *  Never surfaces `detail` — it may contain server internals. */
	private _errorMessage(error: unknown, fallback: string): string
	{
		if (!error || typeof error !== "object") return fallback;
		const e = error as Record<string, unknown>;
		if (typeof e["code"] === "string")
		{
			switch (e["code"])
			{
				case "UNAUTHORIZED": return "You are not authorised to perform this action.";
				case "FORBIDDEN": return "You do not have permission to perform this action.";
			}
		}
		if (typeof e["error"] === "string" && e["error"]) return e["error"];
		return fallback;
	}
}
