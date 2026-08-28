import type { OidcAuthConfig } from "./oidc-config.types";

/**
 * Configures the signed-cookie handling shared by production OIDC and Tier 3 development login.
 *
 * The cookie name isolates browser surfaces, the secure flag follows the ingress transport, the
 * maximum age bounds both cookie and server-side session lifetime, and the secret signs the session
 * independently of any coordinator proof.
 *
 * Called by: the production OIDC service and the Tier 3 application composition before routers mount.
 * @see ___CreateBrowserSessionMiddleware
 */
export type BrowserSessionConfig = Pick<OidcAuthConfig, "cookieName" | "cookieSecure" | "sessionMaxAgeMs" | "sessionSecret">;
