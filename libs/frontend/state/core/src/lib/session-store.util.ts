import { Capabilities } from "./session-store.types";
import type { PlatformSurface } from "./platform-surface.types";

/**
 * Pure capability-derivation rule for the session store, factored out so the
 * authentication/authority to {@link Capabilities} mapping can be unit-tested without
 * Angular DI or driving the `me` resource. The store calls this from its
 * `capabilities` computed; the API remains the enforcement point.
 *
 * Scoped to a single {@link PlatformSurface}: each surface honours **only its own
 * authority dimension** — `isPlatformOperator` on the `"platform"` surface and the central
 * `organization:administer` capability on the `"org"` surface. The two are strictly separated (different domains and
 * logins, one shared OIDC), so a claim belonging to the other surface grants
 * nothing here, and the `operator` union below can never combine powers across
 * surfaces because at most one tier is ever live for a given surface. Everything
 * is additionally gated on `authenticated`, so an unauthenticated session grants
 * nothing regardless of the authority inputs. The API remains the enforcement point.
 *
 * @param authenticated      - Whether a opencrane-ui session is established.
 * @param isPlatformOperator - Platform-operator claim (fleet-wide); honoured only on the `"platform"` surface.
 * @param administerOrganization - Central product decision for this organisation; honoured only on the `"org"` surface.
 * @param surface            - Which surface this app build serves (see {@link PlatformSurface}).
 */
export function _DeriveCapabilities(authenticated: boolean, isPlatformOperator: boolean, administerOrganization: boolean, surface: PlatformSurface): Capabilities
{
	// A surface honours only its own authority source; a cross-domain fact grants nothing.
	const platformOperator = surface === "platform" && authenticated && isPlatformOperator;
	const customerAdmin = surface === "org" && authenticated && administerOrganization;
	// At most one tier is live per surface, so this union never crosses domains.
	const operator = platformOperator || customerAdmin;
	return {
		isOperator: operator,
		isPlatformOperator: platformOperator,
		customerAdmin,
		manageCustomers: platformOperator,
		managePolicies: operator,
		manageBudgets: operator
	};
}
