import { Injectable, inject } from "@angular/core";

import type { paths } from "@opencrane/contracts";
import { CONTROL_PLANE_BASE_URL } from "./api-client.types";
import { OpenCraneApiClientBase } from "./api-client.base";

/**
 * Typed HTTP client for the OpenCrane **Control Plane** API (per-tenant/org
 * surface: `/auth`, `/tenants`, `/mcp`, `/models`, `/policies`, …).
 *
 * Intra-repo contract: `paths` is the SAME generated type the backend's own
 * `@opencrane/contracts` package exports, built directly from
 * `dist/apps/opencrane/openapi.json` via `nx run contracts:generate`
 * (`openapi-typescript`). No cross-repo spec pin — frontend and backend share
 * one generated source of truth. All feature data access must flow through
 * services in `core/api`.
 *
 * Auth helpers (`signIn`/`signInUrl`, the 401→login middleware) and the untyped
 * `request()` escape hatch come from {@link OpenCraneApiClientBase}; this surface
 * owns the org-admin OIDC session.
 */
@Injectable({ providedIn: "root" })
export class ControlPlaneApiService extends OpenCraneApiClientBase<paths>
{
	public constructor()
	{
		super(inject(CONTROL_PLANE_BASE_URL, { optional: true }) ?? "");
	}
}
