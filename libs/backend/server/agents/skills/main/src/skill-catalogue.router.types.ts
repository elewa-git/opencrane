import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { SkillCatalogueRepository } from "./skill-catalogue.types.js";

/**
 * The one fact this router needs about the caller: which silo they are in.
 *
 * Nothing else is carried on purpose — the catalogue is read-only, so there is no role to check. The
 * silo is derived from the authenticated session and request host, never from anything the caller
 * sends, and it scopes every query.
 */
export interface SkillCatalogueCaller
{
	/** Silo derived from the authenticated request host. */
	readonly siloId: string;
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
	/** Reads the bounded catalogue from the resolved silo only. */
	readonly catalogue: SkillCatalogueRepository;
	/** Records unexpected catalogue persistence failures without logging skill content. */
	readonly logger: Logger;
}
