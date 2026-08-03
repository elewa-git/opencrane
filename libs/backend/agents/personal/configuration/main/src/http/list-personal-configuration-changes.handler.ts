import type { Request, RequestHandler, Response } from "express";

import { PersonalConfigurationHttpErrors, type PersonalConfigurationRouterDependencies } from "./personal-configuration.router.types.js";

/**
 * Creates the self-only HTTP boundary for reading a caller's recent configuration-change history.
 *
 * The handler derives both ownership coordinates from the authenticated request instead of route or
 * query input, and exposes only the bounded view returned by the read repository. Persistence
 * failure becomes one stable availability response, preventing infrastructure details from leaking
 * into the browser contract.
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
