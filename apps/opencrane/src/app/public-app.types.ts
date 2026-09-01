import type { RequestHandler, Router } from "express";

/** Browser authentication built once and shared by the public and internal listeners. */
export interface PublicAuthenticationComposition
{
	/** Authentication routes selected by the process entrypoint. */
	readonly router: Router;
	/** One signed-session middleware instance and store shared by both listeners. */
	readonly sessionMiddleware: readonly RequestHandler[];
	/** Product authentication middleware shared by HTTP requests and WebSocket upgrades. */
	readonly authMiddleware: RequestHandler;
}
