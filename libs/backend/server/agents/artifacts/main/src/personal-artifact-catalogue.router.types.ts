import type { Request } from "express";

import type { Logger } from "@opencrane/backend/observability";

import type { PersonalArtifactCatalogueRepository } from "./artifact-finalization.types";

/**
 * Who is asking, as established by the session and the request host.
 *
 * Both fields come from verified request facts, never from anything the browser can set freely.
 * They are the only inputs to the asset query, which is what makes the listing owner-only.
 */
export interface PersonalArtifactCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Signed-in owner whose assets may be listed. */
	readonly ownerPrincipalId: string;
}

/**
 * Everything `__CreatePersonalArtifactCatalogueRouter` needs, supplied by the app.
 *
 * Called by: `_CreatePersonalArtifactCatalogueRouter` in
 * prisma-personal-artifact-catalogue.router.ts.
 */
export interface PersonalArtifactCatalogueRouterDependencies
{
	/** Resolves an authenticated browser caller and trusted host silo. */
	resolveCaller(request: Request): PersonalArtifactCaller | null;
	/** Reads only browser-safe metadata owned by the resolved caller. */
	readonly catalogue: PersonalArtifactCatalogueRepository;
	/** Records unexpected persistence failures without logging artifact metadata. */
	readonly logger: Logger;
}
