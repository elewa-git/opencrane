import { Router, type Request, type Response } from "express";

import type { SkillCatalogueRouterDependencies } from "./skill-catalogue.router.types.js";

/** Create the browser-session-authenticated, read-only skill catalogue router. */
export function __CreateSkillCatalogueRouter(dependencies: SkillCatalogueRouterDependencies): Router
{
	const router = Router();
	router.get("/", async function _list(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "skill_catalogue_authentication_required" }); return; }
		try
		{
			const skills = await dependencies.catalogue.listCatalogue(caller.siloId);
			response.status(200).json({ skills });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skills.catalogue.list", siloId: caller.siloId }, "Skill catalogue list failed");
			response.status(503).json({ error: "skill_catalogue_unavailable" });
		}
	});
	return router;
}
