import { Injectable, type Provider } from "@angular/core";

import { PLATFORM_PREFERENCE_STORE } from "./platform-preference-store.token";
import type { PlatformPreferenceStore } from "./platform-preference-store.types";

/**
 * Stores small application preferences in browser local storage through
 * {@link PlatformPreferenceStore}.
 *
 * A browser can omit or deny access to local storage. Reads then behave as missing values, writes
 * report failure, and removals do nothing, so preference storage cannot prevent application
 * bootstrap or local archetype selection.
 *
 * Called by: Angular creates this class through {@link provideWebPreferenceStore} for the
 * `PLATFORM_PREFERENCE_STORE` token.
 * @implements PlatformPreferenceStore
 */
@Injectable()
export class WebPlatformPreferenceStore implements PlatformPreferenceStore
{
	/**
	 * Reads a browser-local preference and converts unavailable or denied storage to a missing value.
	 *
	 * @param key - Preference key supplied by the application profile.
	 * @returns The saved value, or null when it is absent or browser storage cannot be read.
	 */
	public read(key: string): string | null
	{
		try
		{
			return _BrowserStorage()?.getItem(key) ?? null;
		}
		catch
		{
			return null;
		}
	}

	/**
	 * Attempts to save a browser-local preference without making browser storage required.
	 *
	 * @param key - Preference key supplied by the application profile.
	 * @param value - Value to retain for later browser sessions on this origin.
	 * @returns True after `setItem` succeeds; false when storage is unavailable or rejects the write.
	 */
	public write(key: string, value: string): boolean
	{
		try
		{
			const storage = _BrowserStorage();

			if (!storage)
			{
				return false;
			}

			storage.setItem(key, value);
			return true;
		}
		catch
		{
			return false;
		}
	}

	/**
	 * Removes a browser-local preference when storage permits it. Missing or denied storage is ignored
	 * so cleanup of an invalid preference cannot block the caller's fallback.
	 *
	 * @param key - Preference key to remove.
	 */
	public remove(key: string): void
	{
		try
		{
			_BrowserStorage()?.removeItem(key);
		}
		catch
		{
			return;
		}
	}
}

/**
 * Registers the browser implementation for the runtime-owned preference port.
 *
 * Called by: `OPENCRANE_UI_GATEWAY_PROVIDERS` in `gateway-profile.providers.local.ts`.
 * @returns The Angular provider for `PLATFORM_PREFERENCE_STORE`.
 */
export function provideWebPreferenceStore(): Provider
{
	return { provide: PLATFORM_PREFERENCE_STORE, useClass: WebPlatformPreferenceStore };
}

/** Return browser local storage only when the current runtime exposes it. */
function _BrowserStorage(): Storage | null
{
	if (typeof globalThis.localStorage === "undefined")
	{
		return null;
	}

	return globalThis.localStorage;
}
