import { InjectionToken } from "@angular/core";

/**
 * Injection token carrying the base URL of the OpenCrane **Control Plane** API
 * (per-tenant/org surface: `/auth`, `/tenants`, `/mcp`, `/models`, `/policies`, …).
 * Defaults to same-origin when not provided (see ControlPlaneApiService).
 */
export const CONTROL_PLANE_BASE_URL: InjectionToken<string> = new InjectionToken<string>("WO_CONTROL_PLANE_BASE_URL");

/**
 * Injection token carrying the base URL of the OpenCrane **Fleet Manager** API
 * (fleet/platform surface: `/cluster-tenants`, `/billing-accounts`, `/platform/dns`).
 * Defaults to same-origin when not provided (see FleetManagerApiService). In dev
 * both surfaces are fronted by one host, so the same-origin default works for both.
 */
export const FLEET_MANAGER_BASE_URL: InjectionToken<string> = new InjectionToken<string>("WO_FLEET_MANAGER_BASE_URL");

/**
 * Supplies the transport used by generated and transitional OpenCrane API requests.
 *
 * Called by: `ControlPlaneApiService` and `FleetManagerApiService`; the Tier 1 local profile
 * replaces it with a rejecting transport so an accidentally retained live adapter cannot leave the
 * browser.
 */
export const OPENCRANE_API_FETCH: InjectionToken<typeof fetch> = new InjectionToken<typeof fetch>("OPENCRANE_API_FETCH", {
	providedIn: "root",
	factory: function _BrowserFetch(): typeof fetch
	{
		return globalThis.fetch.bind(globalThis);
	}
});

/** Configures the base URL used when constructing a typed OpenCrane client. */
export interface ApiClientConfig
{
	/** Absolute or same-origin base URL of the API (no trailing slash). */
	baseUrl: string;
}
