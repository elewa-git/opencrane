import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { SkillCatalogueRepository } from "./skill-catalogue.types";

/**
 * The trusted identity facts this router needs for catalogue discovery.
 *
 * The silo and local Principal come from the authenticated session and request host. The central
 * authority uses the Principal's stored direct and Group grants; request claims do not widen it.
 */
export interface SkillCatalogueCaller
{
	/** Silo derived from the authenticated request host. */
	readonly siloId: string;
	/** Local Principal derived from the verified browser session. */
	readonly principalId: string;
}

/**
 * What {@link __CreateSkillCatalogueRouter} needs supplied: how to identify the caller, where to read
 * the catalogue, and where to log failures.
 *
 * Production values come from `prisma-skill-catalogue.router.ts`; tests substitute fakes so the
 * handler can be exercised without a database.
 */
export interface SkillCatalogueRouterDependencies
{
	/** Resolves the authenticated browser caller and trusted host silo. */
	resolveCaller(request: Request): SkillCatalogueCaller | null;
	/** Reads the bounded catalogue allowed for the resolved Principal. */
	readonly catalogue: SkillCatalogueRepository;
	/** Records unexpected catalogue persistence failures without logging skill content. */
	readonly logger: Logger;
}
