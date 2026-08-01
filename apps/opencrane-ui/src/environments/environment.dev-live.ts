import { GatewayMode } from "@opencrane/state/gateways";

/**
 * Developer-machine environment pointed at a **live** OpenCrane cluster.
 *
 * Same live gateway binding as production, but selected by the `development-live`
 * build/serve configuration (no optimisation, source maps on) so a developer can
 * run `localhost:4200` against the real opencrane-ui through the dev proxy
 * (`apps/opencrane-ui/proxy.conf.json`). The committed default (`environment.ts`)
 * stays on mocks so the plain `nx serve`/unit-test path is unaffected.
 */
export const environment: { gatewayMode: GatewayMode } =
{
	/** Bind every swappable gateway to its live implementation where one exists. */
	gatewayMode: "live"
};
