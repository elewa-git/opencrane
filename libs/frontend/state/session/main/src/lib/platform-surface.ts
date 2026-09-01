import { InjectionToken } from "@angular/core";

import type { PlatformSurface } from "./platform-surface.types";

/**
 * Which of the two strictly-separated WeOwnAI surfaces an app build serves.
 *
 * Platform control and organisation product authorization live on **different domains with
 * different logins** (one shared OIDC provider) — they are not gradations of a single console.
 * Capability derivation is therefore scoped to a surface and honours only that surface's own
 * authority source (see {@link _DeriveCapabilities}).
 *
 * - `"platform"` — the fleet/platform-operator app (`apps/fleet`): fleet-wide
 *   customer / tenant / billing management, keyed off `isPlatformOperator`.
 * - `"org"` — the customer/org app (`apps/opencrane-ui`): the end-user workspace plus
 *   account management, keyed off the central `organization:administer` capability.
 */
/**
 * DI token naming the surface the current app build serves. Each app provides it
 * exactly once (`fleet` → `"platform"`, `opencrane-ui` → `"org"`);
 * {@link SessionStore} reads it so an authority input unlocks controls only on its own surface.
 */
export const PLATFORM_SURFACE = new InjectionToken<PlatformSurface>("WO_PLATFORM_SURFACE");
