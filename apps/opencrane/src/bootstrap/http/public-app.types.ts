import type { RequestHandler } from "express";

import type { OidcAuthService } from "@opencrane/backend/server/iam/identity";

/** Browser authentication built once and shared by the public and internal listeners. */
export interface PublicAuthenticationComposition
{
	/** OIDC authority used by the public login and callback routes. */
	readonly authService: OidcAuthService;
	/** One signed-session middleware instance and store shared by both listeners. */
	readonly sessionMiddleware: readonly RequestHandler[];
	/** Product authentication middleware shared by HTTP requests and WebSocket upgrades. */
	readonly authMiddleware: RequestHandler;
}
