import type { RequestHandler, Router } from "express";

import type { RateLimitOptions } from "@opencrane/backend/server/infra/http";
import type { PersonaOnboardingWorkflowPort } from "@opencrane/backend/agents/personal/personas";

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

/** Optional rate-limiter overrides for the shares router, used mainly by tests. */
export interface SharesRouteOptions
{
	/** Shared HTTP limiter options applied before the shares router. */
	readonly rateLimit?: RateLimitOptions;
}

/** The durable-onboarding HTTP routes and persona notifications, composed together. */
export interface UserOnboardingRouteComposition
{
	/** Owner-only durable routing-state API. */
	readonly router: Router;
	/** Persona lifecycle notifications: they move initial onboarding forward, and are accepted and ignored once onboarding is done. */
	readonly personaWorkflow: PersonaOnboardingWorkflowPort;
}
