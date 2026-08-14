import { Router, type Request, type Response } from "express";

import type { PersonalArtifactCatalogueRouterDependencies } from "./personal-artifact-catalogue.router.types";

/**
 * Build the one route a signed-in user calls to list their own assets.
 *
 * `GET /` returns `{ assets }`. The owner and silo come from `resolveCaller`, never from the
 * query string or body, so a user cannot ask for someone else's assets. A missing session is 401
 * and a database failure is 503 with a fixed error string - no artifact metadata is included in
 * either, and only the silo id is logged.
 *
 * Called by: `_CreatePersonalArtifactCatalogueRouter` in
 * prisma-personal-artifact-catalogue.router.ts, mounted at `/api/v1/me/assets` by
 * apps/opencrane/src/app/routes.ts.
 *
 * @param dependencies - Caller resolver, catalogue repository, and logger.
 * @returns An Express router to mount under the authenticated public API.
 */
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
