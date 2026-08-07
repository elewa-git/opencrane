import { Injectable, inject } from "@angular/core";

import type { paths } from "./generated/fleet-manager";
import { FLEET_MANAGER_BASE_URL } from "./api-client.types";
import { OpenCraneApiClientBase } from "./api-client.base";

/**
 * Typed HTTP client for the OpenCrane **Fleet Manager** API (fleet/platform
 * surface: `/cluster-tenants`, `/billing-accounts`, `/platform/dns`, …).
 *
 * Generated from the pinned OpenAPI contract in
 * `openapi/opencrane-fleet-manager.json` (see `npm run sync-spec`). This surface
 * owns its **own** platform-operator OIDC session: auth helpers and the
 * 401→login redirect (inherited from {@link OpenCraneApiClientBase}) target the
 * Fleet Manager API's own `/auth/login` — it does not borrow the Control Plane's.
 *
 * In dev both surfaces are fronted by a single host, so the same-origin default
 * works; set {@link FLEET_MANAGER_BASE_URL} to split the hosts in production.
 */
@Injectable({ providedIn: "root" })
export class FleetManagerApiService extends OpenCraneApiClientBase<paths>
{
	public constructor()
	{
		super(inject(FLEET_MANAGER_BASE_URL, { optional: true }) ?? "");
	}
}
