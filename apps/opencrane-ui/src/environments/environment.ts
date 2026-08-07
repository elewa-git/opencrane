import { GatewayMode } from "@opencrane/state/gateways";

/**
 * Default (development) environment for the opencrane-ui (org-admin) app.
 *
 * Data gateways bind to their in-memory mocks here; the production build
 * replaces this file with `environment.prod.ts` (see `fileReplacements` in
 * `apps/opencrane-ui/project.json`).
 */
export const environment: { gatewayMode: GatewayMode } =
{
	/** Bind every swappable gateway to its mock implementation. */
	gatewayMode: "mock"
};
