import { InjectionToken } from "@angular/core";

import type { PlatformSurface } from "./platform-surface.types";
import type { SessionUser } from "./session-store.types";

/**
 * Describes the identity state returned by a {@link SessionGateway} for one application surface.
 * {@link SessionStore} keeps this value in memory and derives UI capabilities from explicit role
 * claims; it does not treat the snapshot as server-side authorization.
 */
export interface SessionSnapshot
{
	/** Whether the browser owns an active session. */
	readonly authenticated: boolean;
	/** Authenticated identity, or null/absent when the browser is anonymous. */
	readonly user?: SessionUser | null;
}

/**
 * Defines the identity operations the app-wide {@link SessionStore} needs without naming an HTTP
 * client or an in-memory fixture. Implementations route each operation through the authority that
 * owns the requested {@link PlatformSurface}; a load failure remains an error so the session
 * resource and route guards can handle an unavailable authority without granting capabilities.
 *
 * Called by: {@link SessionStore}, which passes its injected application surface to both methods.
 */
export interface SessionGateway
{
	/**
	 * Loads identity state from the authority that owns the selected surface.
	 * @returns The current authenticated or anonymous browser session.
	 * @throws The underlying authority error when identity cannot be loaded.
	 */
	load(surface: PlatformSurface): Promise<SessionSnapshot>;
	/**
	 * Ends the session through the authority that owns the selected surface.
	 * @returns A promise that resolves after the implementation finishes its logout work.
	 */
	logout(surface: PlatformSurface): Promise<void>;
}

/**
 * Lets an application profile bind a session implementation without making {@link SessionStore}
 * depend on that implementation. The token has no fallback factory, so an incomplete profile fails
 * during store construction rather than silently choosing an authority.
 */
export const SESSION_GATEWAY = new InjectionToken<SessionGateway>("OPENCRANE_SESSION_GATEWAY");
