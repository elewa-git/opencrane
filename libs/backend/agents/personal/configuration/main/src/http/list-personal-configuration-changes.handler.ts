import type { Request, RequestHandler, Response } from "express";

import { PersonalConfigurationHttpErrors, type PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/**
 * Creates the route where a user reads their own recent configuration changes.
 *
 * The silo and user come from the authenticated request, never from the path or query string, so
 * there is no way to ask for anyone else's history. The response carries at most the fifty
 * proposals the read repository returns, newest first, with no paging.
 *
 * Any database failure becomes a single 503, so no infrastructure detail reaches the browser.
 *
 * Called by: {@link __CreatePersonalConfigurationRouter}.
 *
 * @param dependencies - Repositories and logger.
 * @returns An Express handler answering 200, 401 or 503.
 */
export function _CreateListPersonalConfigurationChangesHandler(dependencies: PersonalConfigurationRouterDependencies): RequestHandler
{
	return async function _ListPersonalConfigurationChanges(request: Request, response: Response): Promise<void>
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null)
		{
			response.status(401).json({ error: PersonalConfigurationHttpErrors.AuthenticationRequired });
			return;
		}

		try
		{
			const changes = await dependencies.changes.listOwned(caller.siloId, caller.userId);
			response.status(200).json({ changes });
		}
		catch (error)
		{
			dependencies.logger.error({ err: error, operation: "personal_configuration.list", siloId: caller.siloId }, "Personal configuration list failed");
			response.status(503).json({ error: PersonalConfigurationHttpErrors.ListUnavailable });
		}
	};
}
