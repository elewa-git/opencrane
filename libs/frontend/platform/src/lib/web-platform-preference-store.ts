import { Injectable, type Provider } from "@angular/core";

import { PLATFORM_PREFERENCE_STORE } from "./platform-preference-store.token";
import type { PlatformPreferenceStore } from "./platform-preference-store.types";

/** Uses browser local storage while treating denied or unavailable storage as an empty store. */
@Injectable()
export class WebPlatformPreferenceStore implements PlatformPreferenceStore
{
	/** Read one browser-local preference without letting a storage security error escape. */
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

	/** Save one browser-local preference when local storage is available. */
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

	/** Remove one browser-local preference without failing application bootstrap. */
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

/** Bind the browser implementation at the application composition root. */
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
