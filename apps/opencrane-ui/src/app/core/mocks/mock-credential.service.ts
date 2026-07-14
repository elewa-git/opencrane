import { Injectable, inject, signal } from "@angular/core";

import { UiMockScenario } from "../models/mock-scenario.types.js";
import { UiPersonalAccessToken, UiProviderCredential } from "../models/settings.types.js";
import { _DefaultPersonalTokens, _DefaultProviderCredentials } from "./fixtures/settings.fixtures.js";
import { MockClockService } from "./mock-clock.service.js";

/** Owns safe credential metadata and transient one-time token reveal state. */
@Injectable()
export class MockCredentialService
{
	/** Deterministic counter owner used for collision-free token identifiers. */
	private readonly _clock = inject(MockClockService);

	/** Mutable safe provider credential metadata. */
	private readonly _providers = signal<readonly UiProviderCredential[]>(_DefaultProviderCredentials());

	/** Mutable safe personal access-token metadata. */
	private readonly _tokens = signal<readonly UiPersonalAccessToken[]>(_DefaultPersonalTokens());

	/** Transient one-time token reveal value. */
	private readonly _revealedToken = signal<string | null>(null);

	/** Read-only safe provider credential metadata. */
	public readonly providers = this._providers.asReadonly();

	/** Read-only safe personal access-token metadata. */
	public readonly tokens = this._tokens.asReadonly();

	/** Read-only transient one-time token reveal value. */
	public readonly revealedToken = this._revealedToken.asReadonly();

	/** Creates deterministic safe token metadata and a transient one-time reveal. */
	public createToken(name: string): void
	{
		const tokenId = this._clock.nextId("token-ui");
		const token: UiPersonalAccessToken = { id: tokenId, name: name.trim() || "UI token", createdAt: "14 July 2026", prefix: "oc_ui_7F2A" };
		this._tokens.update(function _append(tokens: readonly UiPersonalAccessToken[]): readonly UiPersonalAccessToken[] { return [...tokens, token]; });
		this._revealedToken.set(`oc_ui_mock_${tokenId}_one_time_only`);
	}

	/** Clears the transient token after acknowledgement. */
	public acknowledgeReveal(): void
	{
		this._revealedToken.set(null);
	}

	/** Revokes one mock token by identifier. */
	public revokeToken(tokenId: string): void
	{
		this._tokens.update(function _remove(tokens: readonly UiPersonalAccessToken[]): readonly UiPersonalAccessToken[]
		{
			return tokens.filter(function _keep(token: UiPersonalAccessToken): boolean { return token.id !== tokenId; });
		});
	}

	/** Restores safe credential fixtures and clears transient secrets. */
	public reset(scenario: UiMockScenario = UiMockScenario.Default): void
	{
		this._providers.set(scenario === UiMockScenario.Empty ? [] : _DefaultProviderCredentials());
		this._tokens.set(_DefaultPersonalTokens());
		this._revealedToken.set(null);
	}
}
