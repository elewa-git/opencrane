import type { Request } from "express";

import type { Logger } from "@opencrane/observability";

import type { PersonalArtifactCatalogueRepository } from "./artifact-finalization.types.js";

/** Trusted browser identity used only to select personal assets. */
export interface PersonalArtifactCaller
{
	/** Silo derived from the trusted request host. */
	readonly siloId: string;
	/** Signed-in owner whose assets may be listed. */
	readonly ownerPrincipalId: string;
}

/** Composition ports for the owner-only personal asset catalogue. */
export interface PersonalArtifactCatalogueRouterDependencies
{
	/** Resolves an authenticated browser caller and trusted host silo. */
	resolveCaller(request: Request): PersonalArtifactCaller | null;
	/** Reads only browser-safe metadata owned by the resolved caller. */
	readonly catalogue: PersonalArtifactCatalogueRepository;
	/** Records unexpected persistence failures without logging artifact metadata. */
	readonly logger: Logger;
}
