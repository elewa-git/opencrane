import type { Request } from "express";
import type { Logger } from "@opencrane/observability";

import type { PersonalConfigurationChangeViewRepository } from "./personal-configuration.types.js";

/** Trusted browser identity for the owner-only configuration-proposal read surface. */
export interface PersonalConfigurationCaller
{
	/** Selected silo derived from the trusted request host. */
	readonly siloId: string;
	/** Signed-in user who owns the returned proposal history. */
	readonly userId: string;
}

/** Composition ports for the owner-only personal configuration state router. */
export interface PersonalConfigurationRouterDependencies
{
	/** Resolves the browser caller without accepting owner coordinates from request input. */
	resolveCaller(request: Request): PersonalConfigurationCaller | null;
	/** Reads only durable proposals owned by the resolved caller. */
	readonly changes: PersonalConfigurationChangeViewRepository;
	/** Records unexpected persistence failures without logging patch contents. */
	readonly logger: Logger;
}
