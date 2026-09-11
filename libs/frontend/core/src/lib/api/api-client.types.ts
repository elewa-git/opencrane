import { InjectionToken } from "@angular/core";

/**
 * Injection token carrying the base URL of the OpenCrane **Control Plane** API
 * (per-tenant/org surface: `/auth`, `/tenants`, `/mcp`, `/models`, `/policies`, …).
 * Defaults to same-origin when not provided (see ControlPlaneApiService).
 */
export const CONTROL_PLANE_BASE_URL: InjectionToken<string> = new InjectionToken<string>("WO_CONTROL_PLANE_BASE_URL");

/**
 * Carries headers that every Control Plane request must send.
 *
 * Live builds leave this token unset and authenticate with the ordinary cookie session. The Tier 2
 * build supplies its per-launch development credential so both typed openapi-fetch calls and the
 * temporary untyped request path cross the same local authentication boundary.
 *
 * Called by: {@link ControlPlaneApiService} while it constructs the shared Control Plane transport.
 */
export const CONTROL_PLANE_REQUEST_HEADERS: InjectionToken<Readonly<Record<string, string>>> = new InjectionToken<Readonly<Record<string, string>>>("OPENCRANE_CONTROL_PLANE_REQUEST_HEADERS");

/**
 * Injection token carrying the base URL of the OpenCrane **Fleet Manager** API
 * (fleet/platform surface: `/cluster-tenants`, `/billing-accounts`, `/platform/dns`).
 * Defaults to same-origin when not provided (see FleetManagerApiService). In dev
 * both surfaces are fronted by one host, so the same-origin default works for both.
 */
export const FLEET_MANAGER_BASE_URL: InjectionToken<string> = new InjectionToken<string>("WO_FLEET_MANAGER_BASE_URL");

/** Configuration shape for constructing a typed OpenCrane client. */
export interface ApiClientConfig
{
	/** Absolute or same-origin base URL of the API (no trailing slash). */
	baseUrl: string;
}
