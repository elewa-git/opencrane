import type { Request } from "express";

import type { Logger } from "@opencrane/observability";

import type { SkillCatalogueRepository } from "./skill-catalogue.types.js";

/** Trusted browser identity used only to select a skill catalogue silo. */
export interface SkillCatalogueCaller
{
	/** Silo derived from the authenticated request host. */
	readonly siloId: string;
}

/** Composition ports for the read-only skill catalogue router. */
export interface SkillCatalogueRouterDependencies
{
	/** Resolves the authenticated browser caller and trusted host silo. */
	resolveCaller(request: Request): SkillCatalogueCaller | null;
	/** Reads the bounded catalogue from the resolved silo only. */
	readonly catalogue: SkillCatalogueRepository;
	/** Records unexpected catalogue persistence failures without logging skill content. */
	readonly logger: Logger;
}
