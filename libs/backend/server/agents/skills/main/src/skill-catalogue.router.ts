import { Router, type Request, type Response } from "express";

import type { SkillCatalogueRouterDependencies } from "./skill-catalogue.router.types.js";

/**
 * Builds the read-only skill catalogue router: one `GET /` returning the caller's silo's skills.
 *
 * The silo comes from the authenticated session, never from the request, so there is no way to ask
 * for another silo's skills. There are no write endpoints here at all.
 *
 * Responses: 200 `{ skills }` on success; 401 `skill_catalogue_authentication_required` when the
 * session does not resolve; 503 `skill_catalogue_unavailable` when the read throws, which is logged
 * with the operation and silo but never with skill content.
 *
 * Called by: `_CreateSkillCatalogueRouter` in `prisma-skill-catalogue.router.ts`, mounted at
 * `/api/v1/skills` by apps/opencrane/src/app/routes.ts.
 *
 * @param dependencies - Caller resolution, the catalogue reader, and the logger.
 * @returns An Express router with no prefix of its own; the caller decides where it mounts.
 */
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
