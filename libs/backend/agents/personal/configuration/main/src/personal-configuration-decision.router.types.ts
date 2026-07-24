import type { Request, Router } from "express";

import type { PersonalConfigurationChangeDecisionRepository } from "./personal-configuration.types.js";

/** Authenticated active member allowed to decide their own future-session change. */
export interface PersonalConfigurationDecisionCaller
{
	/** Stable OIDC subject that owns the change record. */
	readonly userId: string;
	/** Exact host-derived ClusterTenant silo containing the change record. */
	readonly siloId: string;
}

/** Dependencies injected into the public personal-configuration decision route. */
export interface PersonalConfigurationDecisionRouterDependencies
{
	/** Resolves active OIDC membership in the host-derived silo; null denies and rejection means unavailable. */
	readonly resolveCaller: (request: Request) => Promise<PersonalConfigurationDecisionCaller | null>;
	/** Performs the sole atomic owner decision transition. */
	readonly decisions: PersonalConfigurationChangeDecisionRepository;
	/** Supplies the server-authoritative decision instant. */
	readonly clock: { readonly now: () => Date };
	/** Emits redacted structured failures without configuration content. */
	readonly logger: { readonly error: (attributes: object, message: string) => void };
}

/** Factory creating the owner-only future-session decision route. */
export type CreatePersonalConfigurationDecisionRouter = (dependencies: PersonalConfigurationDecisionRouterDependencies) => Router;
