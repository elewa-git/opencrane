import type { RequestHandler } from "express";

import type { OidcAuthService } from "@opencrane/backend/server/iam/identity";

/** Shared browser authentication composed once for the public and internal listeners. */
export interface PublicAuthenticationComposition
{
	/** OIDC authority used by the public login and callback routes. */
	readonly authService: OidcAuthService;
	/** One signed-session middleware instance and store shared by both listeners. */
	readonly sessionMiddleware: readonly RequestHandler[];
}
