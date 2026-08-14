import { Provider } from "@angular/core";

import { PLATFORM_BRIDGE } from "./platform-bridge.token.js";
import type { AuthenticationWindowObservation, BoundFolder, PlatformBridge } from "./platform-bridge.types.js";

/** Browser-owned popup observation hidden behind the platform seam. */
class _WebAuthenticationWindowObservation implements AuthenticationWindowObservation
{
	/** Open popup being observed for user closure. */
	private readonly _window: Window;
	/** Feature callback invoked once after closure. */
	private readonly _onClosed: () => void;
	/** Bounded browser timer used only while the popup remains open. */
	private _timer: ReturnType<typeof setInterval> | null;

	/** Start observing one popup. */
	public constructor(window: Window, onClosed: () => void)
	{
		this._window = window;
		this._onClosed = onClosed;
		this._timer = setInterval(this._Observe.bind(this), 250);
	}

	/** Stop observing the popup and release the timer. */
	public stop(): void
	{
		if (this._timer !== null) clearInterval(this._timer);
		this._timer = null;
	}

	/** Report closure once, after first releasing the timer. */
	private _Observe(): void
	{
		if (!this._window.closed) return;
		this.stop();
		this._onClosed();
	}
}

/**
 * Browser implementation of PlatformBridge.
 *
 * The web app has no native filesystem access, so desktop-only capabilities
 * report as unsupported. The future desktop app replaces this provider with an
 * Electron/Tauri-backed implementation.
 */
export class WebPlatformBridge implements PlatformBridge
{
	/** Web is never a desktop shell. */
	public readonly isDesktop: boolean = false;

	/** Folder binding requires the desktop shell; unsupported on the web. */
	public bindFolder(_projectId: string): Promise<BoundFolder>
	{
		return Promise.reject(new Error("Folder binding is only available in the WeOwnAI desktop app."));
	}

	/** Open and observe one same-origin authentication popup. */
	public openAuthenticationWindow(path: string, onClosed: () => void): AuthenticationWindowObservation | null
	{
		const popup = globalThis.open(path, "opencrane-step-up", "popup,width=560,height=720");
		return popup === null ? null : new _WebAuthenticationWindowObservation(popup, onClosed);
	}
}

/** Provides the web PlatformBridge implementation. */
export function provideWebPlatform(): Provider
{
	return { provide: PLATFORM_BRIDGE, useClass: WebPlatformBridge };
}
