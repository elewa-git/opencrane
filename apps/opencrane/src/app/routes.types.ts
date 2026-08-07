import type { RequestHandler, Router } from "express";

import type { RateLimitOptions } from "@opencrane/backend/_server/http";

/** One Express mount shown in the app's route catalogue. */
export interface RouteMount
{
	/** HTTP registration mode used for this mount. */
	readonly method: "get" | "use";
	/** Public or internal path owned by the route. */
	readonly path: string;
	/** Capability router or terminal request handler mounted at the path. */
	readonly handler: Router | RequestHandler;
}

/** Optional bounded limiter tuning for the rate-limited shares composition, primarily in tests. */
export interface SharesRouteOptions
{
	/** Shared HTTP limiter options applied before the shares router. */
	readonly rateLimit?: RateLimitOptions;
}
