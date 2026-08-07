import { InjectionToken } from "@angular/core";

/**
 * Selects which backing implementation every swappable data gateway is bound
 * to for a given app build.
 *
 * - "mock" — in-memory fixtures (default in development and in unit tests).
 * - "live" — the OpenCrane / network-backed gateways (default in production).
 *
 * The per-app environment file sets this once,
 * and the provider helpers in this lib translate it into the concrete DI
 * bindings, so mock-to-live is a single switch rather than scattered edits
 * across both app configs.
 */
export type GatewayMode = "mock" | "live";

/**
 * DI token exposing the active {@link GatewayMode} so UI components can
 * suppress fixture/demo data in live mode without coupling to any specific
 * gateway implementation.
 */
export const GATEWAY_MODE = new InjectionToken<GatewayMode>("WO_GATEWAY_MODE");
