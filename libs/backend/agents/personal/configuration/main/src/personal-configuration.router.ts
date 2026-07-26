import { Router, type Request, type Response } from "express";

import type { PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/** Create the browser-session-authenticated personal configuration proposal state router. */
export function __CreatePersonalConfigurationRouter(dependencies: PersonalConfigurationRouterDependencies): Router
{
	const router = Router();
	router.get("/changes", async function _list(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "configuration_authentication_required" }); return; }
		try
		{
			const changes = await dependencies.changes.listOwned(caller.siloId, caller.userId);
			response.status(200).json({ changes });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "personal_configuration.list", siloId: caller.siloId }, "Personal configuration list failed");
			response.status(503).json({ error: "configuration_list_unavailable" });
		}
	});
	return router;
}
