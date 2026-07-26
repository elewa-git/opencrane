import type { Request } from "express";
import type { Logger } from "@opencrane/observability";

import type { PersonalConfigurationChangeDecisionRepository } from "./personal-configuration.types.js";

/** Authenticated owner identity resolved by the server rather than the browser request body. */
export interface PersonalConfigurationCaller
{
	/** Silo selected from the authenticated request host. */
	readonly siloId: string;
	/** Stable subject who alone may decide their own configuration proposal. */
	readonly userId: string;
}

/** Trusted clock injected by the app to make decision timestamps deterministic in tests. */
export interface PersonalConfigurationClock
{
	/** Return the current server-controlled instant. */
	now(): Date;
}

/** Composition ports for the self-only personal-configuration decision surface. */
export interface PersonalConfigurationRouterDependencies
{
	/** Resolves the authenticated session and host identity, or null for an anonymous request. */
	resolveCaller(request: Request): PersonalConfigurationCaller | null;
	/** Owns the compare-and-set proposal decision lifecycle. */
	changes: PersonalConfigurationChangeDecisionRepository;
	/** Supplies trusted decision timestamps. */
	clock: PersonalConfigurationClock;
	/** Records unexpected persistence failures without request content. */
	logger: Logger;
}
