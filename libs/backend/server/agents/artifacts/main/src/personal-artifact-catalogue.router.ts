import { Router, type Request, type Response } from "express";

import type { PersonalArtifactCatalogueRouterDependencies } from "./personal-artifact-catalogue.router.types.js";

/** Create the browser-session-authenticated, owner-only personal asset catalogue router. */
export function __CreatePersonalArtifactCatalogueRouter(dependencies: PersonalArtifactCatalogueRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _list(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "personal_artifact_authentication_required" }); return; }
		try
		{
			const assets = await dependencies.catalogue.listOwnedCatalogue(caller.siloId, caller.ownerPrincipalId);
			response.status(200).json({ assets });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_artifacts.list", siloId: caller.siloId }, "Personal asset catalogue list failed");
			response.status(503).json({ error: "personal_artifact_catalogue_unavailable" });
		}
	});
	return router;
}
